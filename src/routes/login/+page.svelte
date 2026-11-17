<script lang="ts">
  let { data } = $props();
  const errorText = $derived(
    data.error === "CredentialsSignin"
      ? "That development sign-in was rejected. Check the email and DEV_LOGIN_PASSWORD."
      : data.error
        ? "Sign-in did not finish. Try again."
        : ""
  );
</script>

<svelte:head>
  <link href="https://fonts.bunny.net/css?family=roboto:500" rel="stylesheet" />
</svelte:head>

<main class="login-card stack">
  <a class="wordmark brand" href="/"><span class="mark">E</span>EasySlip</a>
  <h1>Sign in</h1>
  {#if errorText}<p class="callout bad">{errorText}</p>{/if}
  {#if !data.configured}
    <p class="callout">
      Set <code>AUTH_SECRET</code> to a random string of at least 32 characters before anyone can sign in.
      See <code>.env.example</code>.
    </p>
  {:else}
    {#if data.google}
      <form method="POST">
        <input type="hidden" name="providerId" value="google" />
        <input type="hidden" name="redirectTo" value={data.redirectTo} />
        <button class="gsi-material-button" type="submit">
          <div class="gsi-material-button-state"></div>
          <div class="gsi-material-button-content-wrapper">
            <div class="gsi-material-button-icon">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
            </div>
            <span class="gsi-material-button-contents">Continue with Google</span>
            <span style="display: none;">Continue with Google</span>
          </div>
        </button>
      </form>
    {:else}
      <p class="callout">Google sign-in is off until <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> are set.</p>
    {/if}
    {#if data.devLogin === "ready"}
      <form method="POST" class="stack">
        <input type="hidden" name="providerId" value="development" />
        <input type="hidden" name="redirectTo" value={data.redirectTo} />
        <p class="sub">Local development sign-in. Leave this disabled on Render.</p>
        <label><span>Name</span><input name="name" autocomplete="name" /></label>
        <label><span>Email</span><input name="email" type="email" required autocomplete="username" /></label>
        <label><span>Password</span><input name="password" type="password" required autocomplete="current-password" /></label>
        <button class="secondary" type="submit">Sign in for local development</button>
      </form>
    {:else if data.devLogin === "misconfigured"}
      <p class="callout">AUTH_DEV_LOGIN is true, but DEV_LOGIN_PASSWORD needs at least 8 characters.</p>
    {/if}
  {/if}
</main>
