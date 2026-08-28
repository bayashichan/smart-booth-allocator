/**
 * 手入力のカラーコードを #rrggbb（不透明度付きなら #rrggbbaa）に揃える。
 * 「fabd5f」「#FABD5F」「fa0」「0284c722」のいずれも受け付け、不正なら null。
 */
export const normalizeHexColor = (raw: string): string | null => {
    const s = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) return '#' + [...s].map(c => c + c).join('').toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(s) || /^[0-9a-fA-F]{8}$/.test(s)) return '#' + s.toLowerCase();
    return null;
};

/** <input type="color"> に渡せる #rrggbb 形式（不透明度は落とす） */
export const toSwatchValue = (color: string): string => {
    const hex = normalizeHexColor(color);
    return hex ? hex.slice(0, 7) : '#000000';
};
