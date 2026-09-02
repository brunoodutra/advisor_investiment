const STORAGE_URL_KEY = 'SUPABASE_URL';
const STORAGE_ANON_KEY_KEY = 'SUPABASE_ANON_KEY';

function getFileSupabaseConfig() {
    const cfg = window.SUPABASE_LOCAL_CONFIG || {};
    const url = (cfg.url || '').trim();
    const anonKey = (cfg.anonKey || '').trim();
    return { url, anonKey };
}

export function getSupabaseConfig() {
    const fileCfg = getFileSupabaseConfig();
    if (fileCfg.url && fileCfg.anonKey) {
        return fileCfg;
    }

    const url = (localStorage.getItem(STORAGE_URL_KEY) || '').trim();
    const anonKey = (localStorage.getItem(STORAGE_ANON_KEY_KEY) || '').trim();
    return { url, anonKey };
}

export function setSupabaseConfig({ url, anonKey }) {
    const nextUrl = (url || '').trim();
    const nextAnonKey = (anonKey || '').trim();
    if (nextUrl) localStorage.setItem(STORAGE_URL_KEY, nextUrl);
    if (nextAnonKey) localStorage.setItem(STORAGE_ANON_KEY_KEY, nextAnonKey);
}

export function clearSupabaseConfig() {
    localStorage.removeItem(STORAGE_URL_KEY);
    localStorage.removeItem(STORAGE_ANON_KEY_KEY);
}
