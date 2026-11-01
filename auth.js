const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authStatus = document.getElementById("authStatus");
const authSubmit = document.getElementById("authSubmit");
const authModeToggle = document.getElementById("authModeToggle");
const passwordReset = document.getElementById("passwordReset");
const passwordResetForm = document.getElementById("passwordResetForm");
const authHeading = document.getElementById("authHeading");
const authDescription = document.getElementById("authDescription");
const passwordLabel = document.getElementById("passwordLabel");

let authMode = "signin";
const isPasswordRecoveryRedirect = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery"
  || new URLSearchParams(window.location.search).has("code");

function showAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle("is-error", isError);
}

function updateAuthMode() {
  const isSignUp = authMode === "signup";
  authModeToggle.hidden = false;
  passwordLabel.hidden = false;
  authHeading.textContent = isSignUp ? "Utwórz konto" : "Zaloguj się";
  authDescription.textContent = isSignUp
    ? "Konto będzie przechowywać Twoje własne dane Mówika."
    : "Zaloguj się, aby otworzyć swoje dane.";
  authSubmit.textContent = isSignUp ? "Utwórz konto" : "Zaloguj się";
  authModeToggle.textContent = isSignUp ? "Mam już konto — zaloguj się" : "Nie mam konta — utwórz konto";
  passwordReset.hidden = isSignUp;
}

authModeToggle.addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  showAuthStatus("");
  updateAuthMode();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    showAuthStatus("Nie można połączyć z usługą logowania. Odśwież stronę lub skontaktuj się z administratorem.", true);
    return;
  }

  authSubmit.disabled = true;
  try {
    const result = authMode === "signup"
      ? await supabaseClient.auth.signUp({
        email: authEmail.value.trim(),
        password: authPassword.value,
        options: { emailRedirectTo: new URL("index.html", window.location.href).toString() }
      })
      : await supabaseClient.auth.signInWithPassword({
        email: authEmail.value.trim(),
        password: authPassword.value
      });

    if (result.error) throw result.error;
    if (authMode === "signup" && !result.data.session) {
      showAuthStatus("Konto utworzone. Sprawdź pocztę i potwierdź adres e-mail, aby się zalogować.");
      return;
    }
    window.location.replace("index.html");
  } catch (error) {
    console.error("Nie udało się zalogować lub utworzyć konta:", error);
    showAuthStatus(error.message || "Nie udało się wykonać tej czynności.", true);
  } finally {
    authSubmit.disabled = false;
  }
});

passwordReset.addEventListener("click", async () => {
  if (!supabaseClient) {
    showAuthStatus("Nie można połączyć z usługą logowania.", true);
    return;
  }
  if (!authEmail.value.trim()) {
    authEmail.focus();
    showAuthStatus("Wpisz adres e-mail, na który wyślemy link do zmiany hasła.", true);
    return;
  }

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(authEmail.value.trim(), {
      redirectTo: new URL("login.html", window.location.href).toString()
    });
    if (error) throw error;
    showAuthStatus("Jeśli konto istnieje, wysłaliśmy wiadomość z linkiem do zmiany hasła.");
  } catch (error) {
    console.error("Nie udało się wysłać linku do zmiany hasła:", error);
    showAuthStatus(error.message || "Nie udało się wysłać wiadomości.", true);
  }
});

passwordResetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const newPassword = document.getElementById("newPassword").value;
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    await supabaseClient.auth.signOut();
    window.history.replaceState(null, "", window.location.pathname);
    authMode = "signin";
    authForm.hidden = false;
    passwordResetForm.hidden = true;
    updateAuthMode();
    showAuthStatus("Hasło zmienione. Zaloguj się nowym hasłem.");
  } catch (error) {
    console.error("Nie udało się zmienić hasła:", error);
    showAuthStatus(error.message || "Nie udało się zmienić hasła.", true);
  }
});

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      authForm.hidden = true;
      passwordResetForm.hidden = false;
      authModeToggle.hidden = true;
      authHeading.textContent = "Ustaw nowe hasło";
      authDescription.textContent = "Wybierz nowe hasło do swojego konta.";
      passwordLabel.hidden = true;
      authStatus.textContent = "";
      document.getElementById("newPassword").focus();
    } else if (session && event === "INITIAL_SESSION" && !isPasswordRecoveryRedirect) {
      window.location.replace("index.html");
    }
  });
}

updateAuthMode();
