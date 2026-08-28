'use client';

import React, { useState } from 'react';
import { normalizeHexColor, toSwatchValue } from '@/utils/color';

interface ColorFieldProps {
    /** 現在の色（#rrggbb または #rrggbbaa） */
    value: string;
    onChange: (hex: string) => void;
    /** 欄の上に出す見出し。省略すると見出しなし */
    label?: string;
    /** ↩ ボタンを出す。押すと既定に戻す */
    onReset?: () => void;
    title?: string;
    className?: string;
}

/**
 * 色見本（カラーピッカー）とカラーコード入力を並べた欄。
 * ピッカーで選んでも、fabd5f のように直接打ってもよい。
 */
export default function ColorField({ value, onChange, label, onReset, title, className }: ColorFieldProps) {
    // # は欄の外に出すので、入力値には含めない
    const [draft, setDraft] = useState(value.replace(/^#/, ''));
    // 外から色が変わったとき（ピッカー操作・Undo・ファイル読込）は表示を追従させる。
    // レンダー中に前回値と比べて直す、props 同期の定石。
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
        setLastValue(value);
        setDraft(value.replace(/^#/, ''));
    }

    return (
        <div className={className}>
            {label && <span className="text-[10px] text-gray-500 block mb-0.5">{label}</span>}
            <div className="flex items-center gap-1">
                <input type="color" value={toSwatchValue(value)} title={title ?? label}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-7 h-7 shrink-0 rounded border border-gray-200 cursor-pointer p-0" />
                <div className="flex items-center flex-1 min-w-0 border border-gray-200 rounded bg-white px-1">
                    <span className="text-[10px] text-gray-400 shrink-0">#</span>
                    <input type="text" value={draft} placeholder="ffffff"
                        maxLength={9} spellCheck={false} autoComplete="off"
                        onChange={(e) => {
                            setDraft(e.target.value.replace(/^#/, ''));
                            const hex = normalizeHexColor(e.target.value);
                            if (hex) onChange(hex);
                        }}
                        // 打ちかけの不正な値は、欄を離れたら現在の色に戻す
                        onBlur={() => setDraft(value.replace(/^#/, ''))}
                        className="w-full min-w-0 px-0.5 py-1 text-[11px] text-gray-900 bg-transparent outline-none" />
                </div>
                {onReset && (
                    <button onClick={onReset} title="既定に戻す"
                        className="text-[11px] text-gray-400 active:text-gray-700 shrink-0 px-0.5">↩</button>
                )}
            </div>
        </div>
    );
}
