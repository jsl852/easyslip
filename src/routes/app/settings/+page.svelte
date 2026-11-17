<script lang="ts">
  let { data, form } = $props();
  const company = $derived(data.workspace.company);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
</script>

<div class="page-head">
  <div>
    <h1>Company</h1>
    <p class="sub">{company.baseCurrency} books · {company.locale} · role {data.workspace.role}</p>
  </div>
</div>
{#if form?.message}<p class="callout">{form.message}</p>{/if}
<form method="POST" class="card stack">
  <label>
    <span>Name</span>
    <input name="name" required minlength="2" maxlength="120" value={company.name} />
  </label>
  <label>
    <span>Fiscal year starts</span>
    <select name="fiscalYearStartMonth">
      {#each months as month, index (month)}
        <option value={index + 1} selected={company.fiscalYearStartMonth === index + 1}>{month}</option>
      {/each}
    </select>
  </label>
  <p class="sub">The reporting currency stays {company.baseCurrency} in v1. Foreign-currency documents keep their face amount and a warning.</p>
  <button type="submit">Save</button>
</form>
