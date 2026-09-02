import axios from 'axios';
import { Check, Code, Copy, ExternalLink, Key, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { API_URL } from './config';

export default function DevPortal({ token }: { token: string }) {
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    const generateKey = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await axios.post(`${API_URL}/api/gateway/keys/generate`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setApiKey(res.data.apiKey);
            setCopied(false);
        } catch (e: any) {
            setError(e.response?.data?.error || "Erreur de génération des clés. Vérifiez vos permissions Marchand.");
        }
        setLoading(false);
    };

    const copyToClipboard = () => {
        if (apiKey) {
            navigator.clipboard.writeText(apiKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        }
    };

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                    <Code className="mr-3 text-indigo-600" size={32} /> Mongain Developer Portal
                </h1>
                <p className="text-gray-500 mt-2 text-lg">Intégrez la puissance de Mongain Connect directement dans vos applications tierces.</p>
            </div>

            {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 shadow-sm border border-red-100 flex items-center">
                    <ShieldCheck className="mr-2" size={20} />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                    <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                        <Key className="mr-2 text-indigo-500" size={24} /> API Keys (Secrets)
                    </h2>
                    <p className="text-gray-600 mb-6">
                        Générez un clée d'API `sk_live_...` pour lier votre boutique e-commerce.
                        <strong> Attention: Elle ne sera affichée qu'une seule fois !</strong>
                    </p>

                    {!apiKey ? (
                        <button
                            onClick={generateKey}
                            disabled={loading}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg w-full flex justify-center items-center transition-all"
                        >
                            {loading ? "Génération en cours..." : "Révéler la Clé de Production"}
                        </button>
                    ) : (
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <label className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 block">SECRET_KEY (Production)</label>
                            <div className="flex items-center justify-between bg-white border border-gray-300 rounded p-2">
                                <code className="text-gray-800 break-all text-sm font-mono">{apiKey}</code>
                                <button onClick={copyToClipboard} className="ml-2 text-gray-400 hover:text-indigo-600 transition-colors p-2">
                                    {copied ? <Check className="text-green-500" size={20} /> : <Copy size={20} />}
                                </button>
                            </div>
                            <p className="text-red-500 text-xs mt-3 font-semibold">Stockez cette clé dans un endroit sécurisé. Vous ne pourrez plus la revoir.</p>
                        </div>
                    )}
                </div>

                <div className="bg-gradient-to-br from-gray-900 to-indigo-900 p-8 rounded-2xl text-white shadow-lg">
                    <h2 className="text-xl font-bold mb-4 flex items-center">
                        <ExternalLink className="mr-2 text-indigo-300" size={24} /> Documentation Rapide
                    </h2>
                    <p className="text-gray-300 mb-6 text-sm">
                        Utilisez l'API `/api/gateway/charge` pour initier un paiement sur le téléphone de vos clients.
                    </p>

                    <div className="bg-black/40 p-4 rounded-lg border border-white/10 font-mono text-xs text-gray-300 overflow-x-auto">
                        <span className="text-green-400">POST</span> https://api.mongain.com/api/gateway/charge<br /><br />
                        <span className="text-gray-500">Headers:</span><br />
                        Authorization: Bearer <span className="text-yellow-300">sk_live_...</span><br /><br />
                        <span className="text-gray-500">Body:</span><br />
                        {`{
  "customerPhone": "074XXXXX",
  "amount": 15000,
  "orderId": "SHOP_102"
}`}
                    </div>
                </div>
            </div>
        </div>
    );
}
