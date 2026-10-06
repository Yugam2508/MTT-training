import { htmlToText, linksOf, signalsOf, watchStatus } from '../supabase/functions/spc-watch/parse';

const PAGE = `<html><head><style>.x{color:red}</style><script>var t = "register now";</script></head><body>
  <h1>The Singapore Poker Championships</h1><p>December 18-20, 2026 &ndash; Aegean Paradise</p>
  <div><span>SPC XXIII &#8211; Main Event</span> <a href="/register-spc-xxiii">Register&nbsp;now</a></div>
  <p>Get your <a href="https://forms.gle/abc123">Community Card</a></p>
  <a href="/spcxvireport">SPC XVI Report</a>
  <p>Registration opens 1 November for the S$60 satellites.</p>
</body></html>`;

describe('SPC watch parsing', () => {
  it('turns HTML into readable text without scripts or styles', () => {
    const text = htmlToText(PAGE);
    expect(text).toContain('December 18-20, 2026 – Aegean Paradise');
    expect(text).toContain('SPC XXIII – Main Event Register now');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var t');
  });

  it('lists links resolved against the page and flags registration ones', () => {
    const links = linksOf(PAGE, 'https://www.sgpokerchamps.com/');
    expect(links.map((l) => l.href)).toEqual(['https://www.sgpokerchamps.com/register-spc-xxiii', 'https://forms.gle/abc123', 'https://www.sgpokerchamps.com/spcxvireport']);
    expect(links.map((l) => l.reg)).toEqual([true, true, false]);
    expect(links[0].text).toBe('Register now');
  });

  it('notices the site\'s "available soon" placeholders and their replacements', () => {
    const before = signalsOf('Schedule (coming soon) Bookings available soon', 'u').map((s) => s.phrase);
    expect(before).toEqual(expect.arrayContaining(['Bookings available soon', 'coming soon']));
    const after = signalsOf('Schedule Bookings now open', 'u').map((s) => s.phrase);
    expect(after).toEqual(['Bookings now open']);
  });

  it('flags registration phrases and whether they mention the December event', () => {
    const sigs = signalsOf(htmlToText(PAGE), 'https://www.sgpokerchamps.com/');
    const phrases = sigs.map((s) => s.phrase.toLowerCase());
    expect(phrases).toContain('register now');
    expect(phrases).toContain('registration opens');
    expect(sigs.find((s) => /register now/i.test(s.phrase))!.event).toBe(true);
  });

  it('classifies the site as waiting, changed or open', () => {
    const sig = (text: string) => signalsOf(text, 'https://www.sgpokerchamps.com/');
    const home = 'Schedule (coming soon) Get your Community Card Bookings available soon Get exclusive SPC updates and early bird offers';
    const card = [{ href: 'https://spc-members.onrender.com/', text: 'Get your Community Card', from: 'x', reg: false }];
    // today's site: placeholders only
    expect(watchStatus(sig(home), [], card, [])).toBe('waiting');
    // an announced date is not "open"
    expect(watchStatus(sig('Registration opens 1 November'), [], card, [])).toBe('waiting');
    // the schedule page changing, or a placeholder disappearing, is worth a look
    expect(watchStatus(sig(home), [], card, ['https://www.sgpokerchamps.com/schedule'])).toBe('changed');
    expect(watchStatus(sig('Schedule'), sig('Bookings available soon'), card, [])).toBe('changed');
    // registration wording or a registration link means open
    expect(watchStatus(sig('Bookings now open for SPC XXIII'), [], card, [])).toBe('open');
    expect(watchStatus(sig('Main Event: register now'), [], card, [])).toBe('open');
    expect(watchStatus(sig(home), [], [...card, { href: 'https://forms.gle/x', text: 'Register', from: 'x', reg: true }], [])).toBe('open');
  });
});
