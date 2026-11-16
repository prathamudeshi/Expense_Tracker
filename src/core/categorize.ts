/**
 * Keyword & client-rule based categorisation, tuned for Indian merchants,
 * common local clients (like Pills N More, Hubble, Godrej One), and investment flows.
 *
 * Uses clean monochrome geometric symbols (no emojis) so every badge renders
 * in the same accent colour.
 */
export const CATEGORIES = [
  'Food & Drink',
  'Groceries',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Personal Care',
  'Investment',
  'Rent',
  'Education',
  'Transfer',
  'Income',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const UNCATEGORISED: Category = 'Other';

export interface CategoryMeta {
  /** Clean monochrome geometric symbol (never an emoji). */
  icon: string;
  shortLabel: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  'Food & Drink': {icon: '◈', shortLabel: 'Food'},
  Groceries: {icon: '⊞', shortLabel: 'Groceries'},
  Travel: {icon: '⟡', shortLabel: 'Travel'},
  Shopping: {icon: '◇', shortLabel: 'Shopping'},
  'Bills & Utilities': {icon: '⌁', shortLabel: 'Bills'},
  Entertainment: {icon: '▷', shortLabel: 'Media'},
  Health: {icon: '✚', shortLabel: 'Health'},
  'Personal Care': {icon: '✦', shortLabel: 'Care'},
  Investment: {icon: '▲', shortLabel: 'Invest'},
  Rent: {icon: '⌂', shortLabel: 'Rent'},
  Education: {icon: '▣', shortLabel: 'Study'},
  Transfer: {icon: '⇄', shortLabel: 'Transfer'},
  Income: {icon: '↙', shortLabel: 'Income'},
  Other: {icon: '•', shortLabel: 'Other'},
};

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_META[category] ?? {icon: '•', shortLabel: category};
}

/**
 * Short or ambiguous keywords require word boundaries so e.g. 'cred' never
 * matches inside 'credited' and 'lab' never matches inside 'available'.
 */
const WORD_BOUNDARY_KEYWORDS = new Set([
  'cred',
  'vi',
  'lab',
  'gas',
  'cab',
  'bar',
  'sip',
  'emi',
  'lic',
  'ppf',
  'nps',
  'fd',
  'g1',
  'ipo',
  'nse',
  'bse',
  'jpl',
  'gcp',
  'sgb',
  'auto',
  'fuel',
  'toll',
  'chai',
  'rent',
  'mart',
  'dth',
  'gym',
  'spa',
  'meds',
  'cake',
  'water',
  'gift',
  'pant',
  'fuse',
]);

const BOUNDARY_REGEX_CACHE = new Map<string, RegExp>();

export function matchesKeyword(text: string, rawKeyword: string): boolean {
  const keyword = rawKeyword.trim().toLowerCase();
  if (!keyword) {
    return false;
  }
  if (keyword.length <= 4 || WORD_BOUNDARY_KEYWORDS.has(keyword)) {
    let re = BOUNDARY_REGEX_CACHE.get(keyword);
    if (!re) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(`\\b${escaped}\\b`, 'i');
      BOUNDARY_REGEX_CACHE.set(keyword, re);
    }
    return re.test(text);
  }
  return text.includes(keyword);
}

const INVESTMENT_KEYWORDS = [
  'invest',
  'investment',
  'zerodha',
  'groww',
  'upstox',
  'kuvera',
  'indmoney',
  'coin by zerodha',
  'smallcase',
  'etmoney',
  'angel one',
  'dhan',
  'mutual fund',
  'sip',
  'ipo',
  'indian clearing',
  'clearing corp',
  'iccl',
  'nse',
  'bse',
  'cdsl',
  'nsdl',
  'ppf',
  'nps',
  'sovereign gold',
  'sgb',
  'fixed deposit',
  'equities',
  'olectra',
  'jpl',
  'gcp',
];

const RULES: Array<{category: Category; keywords: string[]}> = [
  {
    category: 'Investment',
    keywords: INVESTMENT_KEYWORDS,
  },
  {
    category: 'Personal Care',
    keywords: [
      'hair x studio',
      'hair studio',
      'haircut',
      'salon',
      'barber',
      'beard',
      'trimming',
      'grooming',
      'spa',
      'parlour',
    ],
  },
  {
    category: 'Food & Drink',
    keywords: [
      'pills n more',
      'hubble',
      'hubble cafeteria',
      'godrej one',
      'g1',
      'butterfly high',
      'banglore iyengar bakery',
      'iyengar',
      'maa anjani',
      'naturals',
      'railway canteen',
      'swiggy',
      'zomato',
      'eatsure',
      'dominos',
      'pizza',
      'kfc',
      'mcdonald',
      'mc donalds',
      'mcdonalds',
      'burger',
      'starbucks',
      'barista',
      'chaayos',
      'chai point',
      'chai',
      'cafe',
      'coffee',
      'cold coffee',
      'americano',
      'restaurant',
      'dhaba',
      'biryani',
      'bakery',
      'cake',
      'cakes',
      'sweets',
      'juice',
      'icecream',
      'ice cream',
      'baskin',
      'gelato',
      'subway',
      'faasos',
      'behrouz',
      'wow momo',
      'haldiram',
      'food',
      'kitchen',
      'canteen',
      'bar and',
      'brewery',
      'chaas',
      'chhaas',
      'fanta',
      'pepsi',
      'coke',
      'dosa',
      'idli',
      'mojo pizza',
      'mojo',
      'tictac',
      'fuse',
      'water',
      'breakfast',
      'lunch',
      'dinner',
    ],
  },
  {
    category: 'Groceries',
    keywords: [
      'bigbasket',
      'big basket',
      'blinkit',
      'zepto',
      'instamart',
      'jiomart',
      'dmart',
      'd mart',
      'd-mart',
      'grofers',
      'reliance fresh',
      'reliance smart',
      'more retail',
      'supermarket',
      'super market',
      'kirana',
      'grocer',
      'vegetable',
      'dairy',
      'milk',
      'fruit',
      'provision',
    ],
  },
  {
    category: 'Travel',
    keywords: [
      'uber',
      'ola',
      'rapido',
      'namma yatri',
      'blusmart',
      'irctc',
      'indigo',
      'air india',
      'spicejet',
      'akasa',
      'vistara',
      'redbus',
      'abhibus',
      'makemytrip',
      'goibibo',
      'yatra',
      'ixigo',
      'cleartrip',
      'oyo',
      'airbnb',
      'metro',
      'dmrc',
      'bmtc',
      'bmrcl',
      'petrol',
      'diesel',
      'fuel',
      'hpcl',
      'iocl',
      'bpcl',
      'indian oil',
      'bharat petroleum',
      'hp petrol',
      'shell',
      'nayara',
      'toll',
      'fastag',
      'parking',
      'railway',
      'travels',
      'travel',
      'taxi',
      'cab',
      'auto',
      'tyre',
      'tyre shop',
      'inflation',
    ],
  },
  {
    category: 'Shopping',
    keywords: [
      'amazon',
      'flipkart',
      'fipkart',
      'myntra',
      'ajio',
      'meesho',
      'nykaa',
      'tatacliq',
      'tata cliq',
      'snapdeal',
      'decathlon',
      'ikea',
      'lifestyle',
      'pantaloons',
      'shoppers stop',
      'westside',
      'zudio',
      'croma',
      'reliance digital',
      'vijay sales',
      'apple store',
      'firstcry',
      'lenskart',
      'titan',
      'tanishq',
      'store',
      'mart',
      'retail',
      'fashion',
      'boutique',
      'shoes',
      'shirt',
      'pant',
      'kurta',
      'gift',
      'bhai dooj',
    ],
  },
  {
    category: 'Bills & Utilities',
    keywords: [
      'electricity',
      'bescom',
      'msedcl',
      'mseb',
      'tneb',
      'tangedco',
      'adani electricity',
      'torrent power',
      'kseb',
      'pspcl',
      'uppcl',
      'water bill',
      'bwssb',
      'gas',
      'indane',
      'hp gas',
      'bharat gas',
      'jio',
      'airtel',
      'vodafone',
      'vi',
      'bsnl',
      'recharge',
      'postpaid',
      'prepaid',
      'broadband',
      'fibernet',
      'act fibernet',
      'hathway',
      'tata play',
      'dth',
      'dish tv',
      'insurance',
      'lic',
      'premium',
      'policybazaar',
      'municipal',
      'property tax',
      'utility',
    ],
  },
  {
    category: 'Entertainment',
    keywords: [
      'netflix',
      'spotify',
      'hotstar',
      'jiohotstar',
      'prime video',
      'jiocinema',
      'sonyliv',
      'zee5',
      'aha',
      'youtube',
      'bookmyshow',
      'pvr',
      'inox',
      'cinepolis',
      'cinema',
      'steam',
      'playstation',
      'xbox',
      'nintendo',
      'google play',
      'app store',
      'audible',
      'kindle',
      'gaana',
      'wynk',
      'dream11',
      'gaming',
      'navratri',
    ],
  },
  {
    category: 'Health',
    keywords: [
      'apollo',
      'pharmeasy',
      '1mg',
      'tata 1mg',
      'netmeds',
      'medplus',
      'wellness forever',
      'pharmacy',
      'chemist',
      'medical',
      'meds',
      'hospital',
      'clinic',
      'diagnostic',
      'pathology',
      'lab',
      'dental',
      'dentist',
      'practo',
      'cult.fit',
      'cultfit',
      'gym',
      'fitness',
      'optical',
      'doctor',
      'health',
    ],
  },
  {
    category: 'Rent',
    keywords: ['rent', 'nobroker', 'housing.com', 'landlord', 'maintenance charges', 'society'],
  },
  {
    category: 'Education',
    keywords: [
      'udemy',
      'coursera',
      'unacademy',
      'byju',
      'vedantu',
      'physics wallah',
      'testbook',
      'school',
      'college',
      'university',
      'tuition',
      'coaching',
      'academy',
      'institute',
      'exam fee',
      'course',
      'books',
    ],
  },
  {
    category: 'Transfer',
    keywords: [
      'credit card payment',
      'card payment',
      'cred',
      'self transfer',
      'own account',
      'to self',
      'loan emi',
      'emi',
    ],
  },
];

const NOTE_PRIORITY_RULES: Array<{category: Category; keywords: string[]}> = [
  RULES[0], // Investment
  RULES[1], // Personal Care
  RULES[4], // Travel
  RULES[5], // Shopping
  RULES[2], // Food & Drink
  RULES[3], // Groceries
  RULES[6], // Bills & Utilities
  RULES[7], // Entertainment
  RULES[8], // Health
  RULES[9], // Rent
  RULES[10], // Education
  RULES[11], // Transfer
];

export interface CategoryRule {
  keyword: string;
  category: string;
  counterpartyOverride?: string | null;
  defaultNote?: string | null;
  autoExclude?: boolean;
}

export interface ClassificationMatch {
  category: string;
  counterparty: string | null;
  note: string | null;
  excluded?: boolean;
  matchedRule?: boolean;
}

/**
 * Built-in common client presets derived from the user's real merchants in `data.csv`.
 */
export const DEFAULT_CLIENT_RULES: CategoryRule[] = [
  {keyword: 'pills n more', category: 'Food & Drink', counterpartyOverride: 'Pills N More'},
  {keyword: 'hubble', category: 'Food & Drink', counterpartyOverride: 'Hubble'},
  {keyword: 'godrej one', category: 'Food & Drink', counterpartyOverride: 'Godrej One'},
  {keyword: 'butterfly high', category: 'Food & Drink', counterpartyOverride: 'Butterfly High'},
  {
    keyword: 'banglore iyengar bakery',
    category: 'Food & Drink',
    counterpartyOverride: 'Banglore Iyengar Bakery',
  },
  {keyword: 'hair x studio', category: 'Personal Care', counterpartyOverride: 'Hair X Studio'},
  {keyword: 'hair studio', category: 'Personal Care', counterpartyOverride: 'Hair Studio'},
  {keyword: 'tyre shop', category: 'Travel', counterpartyOverride: 'Tyre Shop'},
  {keyword: 'zerodha', category: 'Investment', counterpartyOverride: 'Invest', defaultNote: 'Zerodha'},
  {keyword: 'groww', category: 'Investment', counterpartyOverride: 'Invest', defaultNote: 'Groww'},
  {keyword: 'upstox', category: 'Investment', counterpartyOverride: 'Invest', defaultNote: 'Upstox'},
  {keyword: 'indian clearing', category: 'Investment', counterpartyOverride: 'Invest'},
  {keyword: 'olectra', category: 'Investment', counterpartyOverride: 'Invest'},
];

/**
 * Full transaction classifier: applies forever client rules, normalizes any
 * Investment counterparty to `"Invest"` (preserving broker/ticker details in
 * `note`), and resolves the category.
 */
export function classifyTransaction(params: {
  counterparty: string | null;
  rawText: string | null;
  direction: 'DEBIT' | 'CREDIT';
  userRules?: CategoryRule[];
  note?: string | null;
}): ClassificationMatch {
  const {direction, rawText} = params;
  const userRules = params.userRules ?? [];
  let counterparty = params.counterparty?.trim() || null;
  let note = params.note?.trim() || null;
  const full = `${counterparty ?? ''} ${note ?? ''} ${rawText ?? ''}`.toLowerCase();

  // 1. Check user-defined & built-in client forever rules
  const allRules = [...userRules, ...DEFAULT_CLIENT_RULES];
  for (const rule of allRules) {
    const kw = rule.keyword.trim().toLowerCase();
    if (kw && matchesKeyword(full, kw)) {
      let nextCp = rule.counterpartyOverride?.trim() || counterparty;
      let nextNote = note || rule.defaultNote?.trim() || null;
      if (rule.category === 'Investment') {
        if (nextCp && nextCp.toLowerCase() !== 'invest' && !nextNote) {
          nextNote = nextCp;
        }
        nextCp = 'Invest';
      }
      return {
        category: rule.category,
        counterparty: nextCp,
        note: nextNote,
        excluded: rule.autoExclude,
        matchedRule: true,
      };
    }
  }

  // 2. Fallback to keyword category guessing
  const category = guessCategory(counterparty, rawText, direction, userRules, note);

  // 3. Enforce: Any investment must be named "Invest"
  if (category === 'Investment' && direction === 'DEBIT') {
    if (counterparty && counterparty.toLowerCase() !== 'invest' && !note) {
      note = counterparty;
    }
    counterparty = 'Invest';
  }

  return {
    category,
    counterparty,
    note,
    matchedRule: false,
  };
}

export function guessCategory(
  counterparty: string | null,
  rawText: string | null,
  direction: 'DEBIT' | 'CREDIT',
  userRules: CategoryRule[] = [],
  note: string | null = null,
): string {
  const name = (counterparty ?? '').trim().toLowerCase();
  const noteText = (note ?? '').trim().toLowerCase();
  const full = `${counterparty ?? ''} ${note ?? ''} ${rawText ?? ''}`.toLowerCase();

  for (const rule of userRules) {
    const keyword = rule.keyword.trim().toLowerCase();
    if (keyword && matchesKeyword(full, keyword)) {
      return rule.category;
    }
  }

  if (noteText) {
    for (const rule of NOTE_PRIORITY_RULES) {
      if (rule.keywords.some(keyword => matchesKeyword(noteText, keyword))) {
        return rule.category;
      }
    }
  }

  if (name) {
    for (const rule of RULES) {
      if (rule.keywords.some(keyword => matchesKeyword(name, keyword))) {
        return rule.category;
      }
    }
  }

  if (direction === 'CREDIT') {
    return 'Income';
  }

  for (const rule of RULES) {
    if (rule.keywords.some(keyword => matchesKeyword(full, keyword))) {
      return rule.category;
    }
  }

  return UNCATEGORISED;
}
