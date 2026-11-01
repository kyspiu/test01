const SUPABASE_URL = "https://iljkalpupcbrcaalxntc.supabase.co";
const SUPABASE_KEY = "sb_publishable_lIKVLGffdWgAK_ErNzTgAw_vneaQw8X";
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;
