import { Markup } from 'telegraf';
import dayjs from 'dayjs';

const WEEKDAYS = ['Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb', 'Mg'];

export const buildCalendarKeyboard = (yearMonth: string) => {
    const monthStart = dayjs(`${yearMonth}-01`);
    const today = dayjs().startOf('day');
    const daysInMonth = monthStart.daysInMonth();
    const firstDow = monthStart.day(); // 0 = Minggu

    const rows: ReturnType<typeof Markup.button.callback>[][] = [];

    rows.push([
        Markup.button.callback('◀', `cal_m:${monthStart.subtract(1, 'month').format('YYYY-MM')}`),
        Markup.button.callback(monthStart.format('MMM YYYY'), 'cal_nop'),
        Markup.button.callback('▶', `cal_m:${monthStart.add(1, 'month').format('YYYY-MM')}`),
    ]);

    rows.push([
        Markup.button.callback('Hari ini', `cal_d:${today.format('YYYY-MM-DD')}`),
        Markup.button.callback('Kemarin', `cal_d:${today.subtract(1, 'day').format('YYYY-MM-DD')}`),
        Markup.button.callback('⌨️ Ketik manual', 'cal_manual'),
    ]);

    rows.push(WEEKDAYS.map((d) => Markup.button.callback(d, 'cal_nop')));

    let day = 1;
    for (let row = 0; row < 6 && day <= daysInMonth; row++) {
        const week: ReturnType<typeof Markup.button.callback>[] = [];
        for (let col = 0; col < 7; col++) {
            if (row === 0 && col < firstDow) {
                week.push(Markup.button.callback(' ', 'cal_nop'));
            } else if (day > daysInMonth) {
                week.push(Markup.button.callback(' ', 'cal_nop'));
            } else {
                const iso = monthStart.date(day).format('YYYY-MM-DD');
                const label = day === today.date() && monthStart.isSame(today, 'month') ? `[${day}]` : `${day}`;
                week.push(Markup.button.callback(label, `cal_d:${iso}`));
                day++;
            }
        }
        if (week.some((b) => (b as any).callback_data !== 'cal_nop')) rows.push(week);
    }

    rows.push([Markup.button.callback('❌ Batal wizard', 'wiz_cancel')]);

    return Markup.inlineKeyboard(rows);
};

export const formatDisplayDate = (iso: string) => dayjs(iso).format('DD/MM/YYYY');
