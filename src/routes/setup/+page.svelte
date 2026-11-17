<script lang="ts">
  let { data, form } = $props();
</script>

<main class="login-card stack">
  <a class="wordmark brand" href="/"><span class="mark">E</span>EasySlip</a>
  <h1>Create the company</h1>
  <p class="sub">Signed in as {data.email}. EasySlip seeds a Hong Kong chart, categories, and a few starter keyword rules you can edit.</p>
  {#if form?.message}<p class="callout bad">{form.message}</p>{/if}
  <form method="POST" class="stack">
    <label>
      <span>Company name</span>
      <input name="name" required minlength="2" maxlength="120" autocomplete="organization" value={form?.name ?? ""} placeholder="Harbour Lane Studio Limited" />
    </label>
    <button type="submit">Create workspace</button>
  </form>
  <form method="POST" action="/signout">
    <input type="hidden" name="redirectTo" value="/" />
    <button class="secondary" type="submit">Sign out</button>
  </form>
</main>
