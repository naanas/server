/** Normalisasi input user → BATB-30375 */
export const parseIssueKey = (raw: string): string | null => {
    const t = raw.trim().toUpperCase().replace(/\\/g, '');
    const m = t.match(/([A-Z]+-\d+)/);
    return m ? m[1] : null;
};
