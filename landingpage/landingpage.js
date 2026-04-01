document.getElementById("googleLogin").addEventListener("click", async () => {
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "http://localhost:5500/dashboard/dashboard.html",
    },
  });

  if (error) {
    console.error("Login error:", error);
  }
});

lucide.createIcons();

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
);

document
  .querySelectorAll(".reveal, .reveal-group")
  .forEach((el) => observer.observe(el));
