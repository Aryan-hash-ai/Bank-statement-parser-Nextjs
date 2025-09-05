import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const apiKey = process.env.PDFCO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Missing PDFCO_API_KEY in .env.local' },
        { status: 500 }
      );
    }

    // --- Get USD → INR exchange rate ---
    const fxRes = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=INR');
    const fxJson = await fxRes.json();
    const usdToInr = fxJson?.rates?.INR || 83; // fallback if API fails

    // --- 1) Upload file ---
    const uploadForm = new FormData();
    uploadForm.append('file', file);

    const uploadRes = await fetch('https://api.pdf.co/v1/file/upload', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: uploadForm
    });

    const uploadJson = await uploadRes.json();
    if (!uploadJson.url) {
      return NextResponse.json({ error: 'Upload to PDF.co failed' }, { status: 500 });
    }

    // --- 2) Convert to CSV ---
    const convertRes = await fetch('https://api.pdf.co/v1/pdf/convert/to/csv', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: uploadJson.url, inline: true, pages: '' })
    });

    const convertJson = await convertRes.json();
    let csvText = convertJson?.body;
    if (!csvText && convertJson?.url) {
      const csvFetch = await fetch(convertJson.url);
      csvText = await csvFetch.text();
    }
    if (!csvText) {
      return NextResponse.json({ error: 'No CSV extracted' }, { status: 500 });
    }

    // --- 3) Parse CSV rows ---
    const rows = csvText
      .trim()
      .split('\n')
      .map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));

    // Helper: clean numeric value and convert to INR
    const cleanNum = val => {
      if (!val) return '';
      let v = val.replace(/\$/g, '').replace(/,/g, '').trim();
      if (v.endsWith('-')) v = '-' + v.slice(0, -1); // move trailing minus
      const num = parseFloat(v) || 0;
      return (num * usdToInr).toFixed(2); // converted INR value
    };

    // Helper: clean description
    const cleanDesc = text =>
      text
        .replace(/continued from previous page/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    // --- 4) Account Summary ---
    const summary = rows
      .filter(r => ['7185072217', '3214424529'].includes(r[0]?.replace(/[^0-9]/g, '')))
      .map(r => {
        const acct = r[0]?.replace(/[^0-9]/g, '');
        return {
          accountNumber: acct,
          accountName:
            acct === '7185072217'
              ? 'Premium Bus Checking'
              : acct === '3214424529'
              ? 'Mbr Business Savings'
              : 'Unknown',
          deposits: cleanNum(r[1]),
          withdrawals: cleanNum(r[2]),
          balance: cleanNum(r[3]),
          ytdDividends: cleanNum(r[4])
        };
      });

    // --- 5) Transactions Parser ---
    const transactions = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      if (/^\d{2}-\d{2}/.test(r[0] || '')) {
        const date = r[0];

        const numericValues = r.filter(x => /[0-9]/.test(x));
        const balance = numericValues.pop() || '';
        const amount = numericValues.pop() || '';

        const descParts = r.slice(1, r.length - 2);
        const description = cleanDesc(descParts.join(' '));

        transactions.push({
          date,
          description,
          amount: cleanNum(amount),
          balance: cleanNum(balance)
        });
      }
    }

    return NextResponse.json({ summary, transactions, currency: "INR" });
  } catch (err) {
    console.error('Extraction error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
