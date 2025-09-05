'use client';
import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const handleFileChange = (e) => setFile(e.target.files[0]);

  const handleUpload = async () => {
    if (!file) return alert('Please select a PDF file.');

    setLoading(true);
    setSummary([]);
    setTransactions([]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/extract-table', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extract table');

      setSummary(data.summary || []);
      setTransactions(data.transactions || []);
    } catch (err) {
      alert('Extraction failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // format with commas, no currency symbols
  const formatNumber = (val) => {
    if (!val) return '';
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">
        📑 PDF Statement Extractor
      </h1>

      {/* Upload */}
      <div className="flex items-center gap-4 mb-8">
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
          className="block text-sm text-gray-700
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-600
            hover:file:bg-blue-100"
        />
        <button
          onClick={handleUpload}
          disabled={loading}
          className={`px-6 py-2 rounded-lg font-medium text-white transition ${
            loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {loading ? 'Extracting…' : 'Extract Tables'}
        </button>
      </div>

      {/* Summary */}
      {summary.length > 0 && (
        <div className="bg-white shadow rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Account Summary</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-600">Account Number</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-600">Account Name</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Deposits</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Withdrawals</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Ending Balance</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">YTD Dividends</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2">{row.accountNumber}</td>
                    <td className="px-4 py-2">{row.accountName}</td>
                    <td className="px-4 py-2 text-right text-green-600">
                      {formatNumber(row.deposits)}
                    </td>
                    <td className="px-4 py-2 text-right text-red-600">
                      {formatNumber(row.withdrawals)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatNumber(row.balance)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formatNumber(row.ytdDividends)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions */}
      {transactions.length > 0 && (
        <div className="bg-white shadow rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Transactions</h2>
          <div className="overflow-x-auto max-h-[600px]">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-gray-600">Date</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-600">Transaction Detail</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold text-gray-600">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 whitespace-nowrap">{row.date}</td>
                    <td className="px-4 py-2">{row.description}</td>
                    <td className="px-4 py-2 text-right text-red-600">
                      {row.debit ? formatNumber(row.debit) : ''}
                    </td>
                    <td className="px-4 py-2 text-right text-green-600">
                      {row.credit ? formatNumber(row.credit) : ''}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatNumber(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {summary.length === 0 && transactions.length === 0 && !loading && (
        <div className="text-gray-500 mt-10 text-center">
          No data yet — upload a PDF and click <span className="font-medium">Extract Tables</span>.
        </div>
      )}
    </main>
  );
}
