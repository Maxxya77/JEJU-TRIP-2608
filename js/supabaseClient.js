import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://cabdioiaotivisfbgnhc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jjsQlnvvh17in4anS0wx9g_v-GE5Hya';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
