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

    //
    // 1) Upload the PDF to PDF.co (temp URL)
    //
    const uploadForm = new FormData();
    uploadForm.append('file', file);

    const uploadRes = await fetch('https://api.pdf.co/v1/file/upload', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: uploadForm
    });
    const uploadJson = await uploadRes.json();

    if (!uploadRes.ok || !uploadJson?.url) {
      return NextResponse.json(
        { error: uploadJson?.message || 'Upload to PDF.co failed' },
        { status: 500 }
      );
    }

    //
    // 2) Convert to plain TEXT (more reliable than CSV for these statements)
    //
    const textRes = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: uploadJson.url,
        inline: true,
        pages: '' // all pages
      })
    });

    const textJson = await textRes.json();
    let text = textJson?.body;
    if (!text && textJson?.url) {
      const t = await fetch(textJson.url);
      text = await t.text();
    }
    if (!text) {
      return NextResponse.json({ error: 'No text extracted from PDF' }, { status: 500 });
    }

    //
    // 3) Parse transactions from plain text
    //    - We detect lines starting with MM-DD
    //    - We extract the last 2 numbers on the line: [amount, balance]
    //    - Trailing minus (e.g., "271.84-") becomes a negative amount
    //    - If a description continues on next lines (no date), we append it
    //
    const cleanSpace = (s) => s.replace(/\s+/g, ' ').trim();

    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length);

    const numberRegex = /(\d{1,3}(?:,\d{3})*\.\d{2})(-?)/g; // captures 1,234.56 and optional trailing '-'
    const dateLineRegex = /^\d{2}-\d{2}\b/;

    const transactions = [];
    let pending = null; // { date, description }

    function finalizeIfPossible(lineForNums, descOverride = null) {
      const matches = [...lineForNums.matchAll(numberRegex)];
      if (matches.length >= 2 && pending) {
        const amtMatch = matches[matches.length - 2];
        const balMatch = matches[matches.length - 1];

        const rawAmt = (amtMatch[1] || '') + (amtMatch[2] || '');
        const rawBal = (balMatch[1] || '') + (balMatch[2] || '');

        const amt = parseFloat(rawAmt.replace(/,/g, '').replace(/-$/, '')) || 0;
        const isNegative = /-$/.test(rawAmt);
        const debit = isNegative ? Math.abs(amt).toFixed(2) : '';
        const credit = !isNegative ? amt.toFixed(2) : '';
        const balance = (parseFloat(rawBal.replace(/,/g, '').replace(/-$/, '')) || 0).toFixed(2);

        // Build clean description: remove the found numbers from the text section
        let desc = descOverride ?? pending.description;
        desc = desc
          .replace(new RegExp(amtMatch[0].replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]')), '')
          .replace(new RegExp(balMatch[0].replace(/\./g, '\\.').replace(/\[/g, '\\[').replace(/\]/g, '\\]')), '');
        desc = desc.replace(/continued from previous page/i, '');
        desc = cleanSpace(desc.replace(/-\s*$/, ''));

        transactions.push({
          date: pending.date,
          description: desc,
          debit,
          credit,
          balance
        });

        pending = null;
        return true;
      }
      return false;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (dateLineRegex.test(line)) {
        // Start a new row
        const [, rest = ''] = line.match(/^\d{2}-\d{2}\s*(.*)$/) || [null, line];
        const date = line.slice(0, 5);

        // If there is already a pending row without numbers, drop it
        // (rare, but keeps parser safe)
        pending = { date, description: cleanSpace(rest) };

        // Try to finalize immediately if the numbers are on the same line
        finalizeIfPossible(line, rest);
      } else {
        // Continuation line for the previous description
        if (pending) {
          pending.description = cleanSpace(`${pending.description} ${line}`);

          // If this continuation line carries the numbers, finalize now
          finalizeIfPossible(line, pending.description);
        }
      }
    }

    // If last pending never got numbers but looks like a "Beginning Balance" line,
    // try to salvage at least the balance
    if (pending) {
      const matches = [...pending.description.matchAll(numberRegex)];
      if (matches.length >= 1) {
        const balMatch = matches[matches.length - 1];
        const rawBal = (balMatch[1] || '') + (balMatch[2] || '');
        const balance = (parseFloat(rawBal.replace(/,/g, '').replace(/-$/, '')) || 0).toFixed(2);
        transactions.push({
          date: pending.date,
          description: cleanSpace(pending.description.replace(balMatch[0], '')),
          debit: '',
          credit: '',
          balance
        });
      }
      pending = null;
    }

    //
    // 4) Build a simple summary from the parsed transactions
    //
    const sum = (arr) =>
      arr.reduce((acc, v) => acc + (parseFloat(v || '0') || 0), 0);

    const totalDebit = sum(transactions.map((t) => t.debit));
    const totalCredit = sum(transactions.map((t) => t.credit));

    // last non-empty balance if available
    let endingBalance = '';
    for (let i = transactions.length - 1; i >= 0; i--) {
      if (transactions[i].balance) {
        endingBalance = transactions[i].balance;
        break;
      }
    }

    const summary = [
      {
        accountNumber: '—',           // optional: set if you want to detect from headers
        accountName: 'Premium Bus Checking', // or detect from text headers if needed
        deposits: totalCredit.toFixed(2),
        withdrawals: totalDebit.toFixed(2),
        balance: endingBalance,
        ytdDividends: ''
      }
    ];

    return NextResponse.json({ summary, transactions });
  } catch (err) {
    console.error('Extraction error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
