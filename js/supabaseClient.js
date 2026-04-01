if (!window.supabaseClientInitialized) {
  const SUPABASE_URL = "https://vlklgpixmavdqobhzasd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsa2xncGl4bWF2ZHFvYmh6YXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTA1MjEsImV4cCI6MjA4OTQyNjUyMX0.D_nJBFI9ct6mwjJimVCIBW0kBuLOGhyHSCnyL9T6yfQ";

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  );

  window.supabaseClientInitialized = true;
}
