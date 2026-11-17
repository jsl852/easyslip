<script lang="ts">
  let { data } = $props();
  const errorText = $derived(
    data.error === "CredentialsSignin"
      ? "That development sign-in was rejected. Check the email and DEV_LOGIN_PASSWORD."
      : data.error
        ? "Sign-in did not finish. Try again, or check the Google redirect URI."
        : ""
  );
</script>

<main class="login-card stack">
  <a class="wordmark brand" href="/"><span class="mark">E</span>EasySlip</a>
  <h1>Sign in</h1>
  <p class="sub">Use your company Google account. EasySlip v1 keeps one company for each member.</p>
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
        <button type="submit">Continue with Google</button>
      </form>
      <p class="sub">Redirect URI to register: <code>{data.callbackUrl}</code></p>
    {:else}
      <p class="callout">Google sign-in is off until <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> are set.</p>
      <p class="sub">Redirect URI to register once those are set: <code>{data.callbackUrl}</code></p>
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
