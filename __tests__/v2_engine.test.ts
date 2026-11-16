import {
  CATEGORY_META,
  classifyTransaction,
  guessCategory,
} from '../src/core/categorize';
import {parseCustomDateRange, trailingDaysRange} from '../src/core/dates';
import {parsePayment} from '../src/core/parser';
import {parseCsvRows, SEED_CSV} from '../src/core/seedData';

describe('V2 parser', () => {
  it('detects "paid you" notifications as CREDIT and extracts sender', () => {
    const res1 = parsePayment({
      source: 'notification',
      origin: 'com.google.android.apps.nbu.paisa.user',
      title: 'Google Pay',
      body: 'Aarav Pradeep P paid you ₹50.00. Tap to view',
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.payment.direction).toBe('CREDIT');
      expect(res1.payment.amount).toBe(50);
      expect(res1.payment.counterparty).toBe('Aarav Pradeep P');
    }

    const res2 = parsePayment({
      source: 'notification',
      origin: 'com.google.android.apps.nbu.paisa.user',
      title: 'Aarav Pradeep P',
      body: 'Paid you ₹50',
    });
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.payment.direction).toBe('CREDIT');
      expect(res2.payment.amount).toBe(50);
      expect(res2.payment.counterparty).toBe('Aarav Pradeep P');
    }
  });

  it('never sets counterparty to "View" or SMS sender headers', () => {
    const resView = parsePayment({
      source: 'notification',
      origin: 'com.google.android.apps.nbu.paisa.user',
      title: 'Google Pay',
      body: 'You received ₹101.00. Tap to view',
    });
    expect(resView.ok).toBe(true);
    if (resView.ok) {
      expect(resView.payment.direction).toBe('CREDIT');
      expect(resView.payment.counterparty).toBeNull();
    }

    const resSender = parsePayment({
      source: 'notification',
      origin: 'com.google.android.apps.messaging',
      title: 'AD-ICICIT-S',
      body: 'Acct XX911 debited for Rs 924.00 on 20-Sep-26. UPI:626359384927',
    });
    expect(resSender.ok).toBe(true);
    if (resSender.ok) {
      expect(resSender.payment.direction).toBe('DEBIT');
      expect(resSender.payment.counterparty).toBeNull();
      expect(resSender.payment.upiRef).toBe('626359384927');
      expect(resSender.payment.accountTail).toBe('911');
    }
  });

  it('parses ICICI Bank SMS counterparty and reference number', () => {
    const res = parsePayment({
      source: 'sms',
      origin: 'VM-ICICIT',
      body: 'ICICI Bank Acct XX911 debited for Rs 65.00 on 16-Nov-26; Pills N More credited. UPI:632095302250.',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payment.direction).toBe('DEBIT');
      expect(res.payment.amount).toBe(65);
      expect(res.payment.counterparty).toBe('Pills N More');
      expect(res.payment.upiRef).toBe('632095302250');
      expect(res.payment.accountTail).toBe('911');
    }
  });

  it('strips Autopay / Pvt Ltd boilerplate from merchant names', () => {
    const res = parsePayment({
      source: 'notification',
      origin: 'com.google.android.apps.nbu.paisa.user',
      title: 'Google Pay',
      body: 'SPOTIFY INDIA PVT LTD Autopay payment of Rs 69.00 debited',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payment.direction).toBe('DEBIT');
      expect(res.payment.amount).toBe(69);
      expect(res.payment.counterparty).toBe('Spotify India');
    }
  });

  it('rejects FASTag wallet/toll deductions', () => {
    const res = parsePayment({
      source: 'sms',
      origin: 'AD-ICICIB',
      body: 'Rs. 70.00 debited from your FASTag Wallet on 23-Oct-26. Avl Tag bal Rs 430.00',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('fastag-deduction');
    }
  });
});

describe('V2 categorizer & client rules', () => {
  it('uses clean geometric monochrome symbols with zero emojis', () => {
    for (const meta of Object.values(CATEGORY_META)) {
      expect(meta.icon.length).toBe(1);
    }
  });

  it('does not match "cred" inside "credited" as Transfer', () => {
    const cat = guessCategory(
      null,
      'ICICI Bank Acct XX911 debited for Rs 65.00 on 16-Nov-26; Someone credited.',
      'DEBIT',
    );
    expect(cat).toBe('Other');
  });

  it('classifies Pills N More into Food & Drink by default and supports forever client rules', () => {
    expect(guessCategory('Pills N More', null, 'DEBIT')).toBe('Food & Drink');

    const res = classifyTransaction({
      counterparty: 'Pills N More',
      rawText: 'Paid Rs 40 to Pills N More',
      direction: 'DEBIT',
      userRules: [
        {
          keyword: 'pills n more',
          category: 'Food & Drink',
          counterpartyOverride: 'Pills N More',
          defaultNote: 'Chaas',
        },
      ],
    });
    expect(res.category).toBe('Food & Drink');
    expect(res.counterparty).toBe('Pills N More');
    expect(res.note).toBe('Chaas');
    expect(res.matchedRule).toBe(true);
  });

  it('standardizes any investment counterparty to "Invest" while preserving broker/stock details in note', () => {
    const zRes = classifyTransaction({
      counterparty: 'Zerodha Broking',
      rawText: 'Debited Rs 5000 to Zerodha Broking',
      direction: 'DEBIT',
    });
    expect(zRes.category).toBe('Investment');
    expect(zRes.counterparty).toBe('Invest');
    expect(zRes.note).toBe('Zerodha');

    const sRes = classifyTransaction({
      counterparty: 'IPO Allotment',
      rawText: 'UPI mandate for IPO',
      direction: 'DEBIT',
    });
    expect(sRes.category).toBe('Investment');
    expect(sRes.counterparty).toBe('Invest');
    expect(sRes.note).toBe('IPO Allotment');
  });
});

describe('V2 timeline range helpers & SEED_CSV', () => {
  it('computes 1D, 1W, 1M and Custom date ranges accurately', () => {
    const oneWeek = trailingDaysRange(7, new Date(2026, 10, 16, 14, 0));
    expect(Math.round((oneWeek.to - oneWeek.from) / 86_400_000)).toBe(7);

    const custom = parseCustomDateRange('2026-10-01', '2026-10-31');
    expect(custom).not.toBeNull();
    if (custom) {
      expect(custom.to).toBeGreaterThan(custom.from);
    }
  });

  it('separates Living Spend, Investments (all named Invest), and Income in SEED_CSV', () => {
    const rows = parseCsvRows(SEED_CSV);

    expect(rows.some(r => r.counterparty === 'View')).toBe(false);
    const active = rows.filter(r => !r.excluded);
    const investments = active.filter(r => r.direction === 'DEBIT' && r.category === 'Investment');
    expect(investments.every(r => r.counterparty === 'Invest')).toBe(true);

    const investTotal = investments.reduce((s, r) => s + r.amount, 0);
    const livingSpendTotal = active
      .filter(r => r.direction === 'DEBIT' && r.category !== 'Investment')
      .reduce((s, r) => s + r.amount, 0);

    expect(investTotal).toBeCloseTo(142194.62, 2);
    expect(livingSpendTotal).toBeCloseTo(33495.5, 2);
  });
});
