<script lang="ts">
  import { page } from "$app/stores";
</script>

<main class="landing">
  <p class="wordmark"><span class="mark">E</span>EasySlip</p>
  <h1>{$page.status}</h1>
  <p class="lede">{$page.error?.message ?? "Something went wrong."}</p>
  <p><a class="button" href="/app">Back to the workspace</a></p>
</main>
