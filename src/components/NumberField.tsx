'use client';

import { useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
    /** 現在の確定値 */
    value: number;
    /** 入力が確定したときに呼ばれる（丸め・クランプは呼び出し側で行う） */
    onCommit: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    title?: string;
    'aria-label'?: string;
    /** 入力が止まってから確定するまでの待ち時間 (ms) */
    commitDelayMs?: number;
}

/**
 * 数値入力欄。
 *
 * 素の <input type="number"> を「値＝親の state」で完全制御すると、
 * 1文字打つたびに親側の丸め・クランプが走って表示が書き換わり、
 * 途中の数字（例: 1200 と打ちたいのに "1"）が別の値に化けてしまう。
 * そのため入力中は文字列のドラフトを保持し、
 *
 *   - 入力が止まったとき（既定 400ms）
 *   - フォーカスが外れたとき
 *   - Enter を押したとき
 *
 * にだけ確定する。確定後は丸め・クランプ済みの値を表示に戻す。
 * Escape で入力を取り消し、± （スピナー）操作もそのまま使える。
 */
export default function NumberField({
    value,
    onCommit,
    min,
    max,
    step,
    className,
    title,
    commitDelayMs = 400,
    ...rest
}: NumberFieldProps) {
    // draft が null のあいだは確定値をそのまま表示する。
    // 入力中は draft を保持し、外から値が変わっても打ちかけの数字を書き換えない。
    const [draft, setDraft] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const clearTimer = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    /** ドラフトを数値として確定する */
    const commit = (raw: string) => {
        clearTimer();
        const n = Number(raw);
        if (raw.trim() === '' || !Number.isFinite(n)) return;
        if (n !== value) onCommit(n);
    };

    return (
        <input
            {...rest}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            title={title}
            className={className}
            value={draft ?? String(value)}
            onFocus={e => {
                // テンキーで打ち直しやすいよう既存の値を選択状態にする
                e.currentTarget.select();
            }}
            onChange={e => {
                const raw = e.target.value;
                setDraft(raw);
                clearTimer();
                timerRef.current = setTimeout(() => commit(raw), commitDelayMs);
            }}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    commit(e.currentTarget.value);
                    e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                    clearTimer();
                    setDraft(null);
                    e.currentTarget.blur();
                }
            }}
            onBlur={() => {
                if (draft !== null) commit(draft);
                // 確定後は丸め・クランプ済みの値を表示に戻す
                setDraft(null);
            }}
        />
    );
}
