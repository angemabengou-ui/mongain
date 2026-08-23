import { Repeat, Search, Shield, Users as UsersIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../config';
import { apiFetch } from '../utils/apiFetch';

type SearchResult = { id: string; name: string; phone?: string; role?: string };
type SearchResponse = { users: SearchResult[]; vaults: (SearchResult & { admin?: { name: string } })[]; tontines: (SearchResult & { creator?: { name: string } })[] };

const EMPTY: SearchResponse = { users: [], vaults: [], tontines: [] };

// Un seul champ, visible sur tout le portail, pour ne plus avoir à deviner dans quel
// écran chercher un client / une caisse commune / une tontine avant de pouvoir taper
// quoi que ce soit — Caisses Communes et Tontines n'avaient même pas de recherche locale.
export default function GlobalSearch({ token, onNavigate }: { token: string; onNavigate: (tab: string, id: string) => void }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResponse>(EMPTY);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const q = query.trim();
        if (q.length < 2) { setResults(EMPTY); setLoading(false); return; }

        setLoading(true);
        debounceRef.current = setTimeout(async () => {
            try {
                const data = await apiFetch(`${API_URL}/api/admin/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
                setResults({ users: data.users || [], vaults: data.vaults || [], tontines: data.tontines || [] });
            } catch {
                setResults(EMPTY);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, token]);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const select = (tab: string, id: string) => {
        onNavigate(tab, id);
        setQuery('');
        setResults(EMPTY);
        setOpen(false);
    };

    const hasResults = results.users.length > 0 || results.vaults.length > 0 || results.tontines.length > 0;
    const showPanel = open && query.trim().length >= 2;

    return (
        <div ref={boxRef} style={{ position: 'relative', width: 340 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                <Search size={15} color="var(--text-muted)" />
                <input
                    value={query}
                    onChange={e => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); } }}
                    placeholder="Rechercher un client, une caisse, une tontine…"
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
                />
            </div>

            {showPanel && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', maxHeight: 420, overflowY: 'auto', zIndex: 100 }}>
                    {loading ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Recherche…</div>
                    ) : !hasResults ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Aucun résultat pour « {query} ».</div>
                    ) : (
                        <>
                            {results.users.length > 0 && (
                                <SearchGroup icon={<UsersIcon size={13} />} label="Clients, Agents & Marchands">
                                    {results.users.map(u => (
                                        <SearchRow key={u.id} onClick={() => select('users', u.id)} title={u.name} subtitle={u.phone} />
                                    ))}
                                </SearchGroup>
                            )}
                            {results.vaults.length > 0 && (
                                <SearchGroup icon={<Shield size={13} />} label="Caisses Communes">
                                    {results.vaults.map(v => (
                                        <SearchRow key={v.id} onClick={() => select('vaults', v.id)} title={v.name} subtitle={v.admin?.name ? `Président : ${v.admin.name}` : undefined} />
                                    ))}
                                </SearchGroup>
                            )}
                            {results.tontines.length > 0 && (
                                <SearchGroup icon={<Repeat size={13} />} label="Tontines">
                                    {results.tontines.map(t => (
                                        <SearchRow key={t.id} onClick={() => select('tontines', t.id)} title={t.name} subtitle={t.creator?.name ? `Créateur : ${t.creator.name}` : undefined} />
                                    ))}
                                </SearchGroup>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function SearchGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                {icon} {label}
            </div>
            {children}
        </div>
    );
}

function SearchRow({ title, subtitle, onClick }: { title: string; subtitle?: string; onClick: () => void }) {
    return (
        <div
            onClick={onClick}
            style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover, var(--bg-secondary))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
            {subtitle && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</span>}
        </div>
    );
}
