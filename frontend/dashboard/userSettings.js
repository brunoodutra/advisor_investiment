import { state } from './state.js?v=20260828a';
import { ensureAuthReady, getSupabaseClient, isLoggedIn } from './auth.js?v=20260828a';

export async function loadUserSettings() {
    await ensureAuthReady();
    if (!isLoggedIn()) return null;
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const userId = state.auth.user.id;
    const { data, error } = await supabase
        .from('user_settings')
        .select('settings')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    const settings = data?.settings || null;
    if (settings && typeof settings === 'object') {
        state.settings = { ...state.settings, ...settings };
    }
    return settings;
}

export async function saveUserSettings(settings) {
    await ensureAuthReady();
    if (!isLoggedIn()) return false;
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    const userId = state.auth.user.id;
    const payload = {
        user_id: userId,
        settings: settings || {},
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    return true;
}

