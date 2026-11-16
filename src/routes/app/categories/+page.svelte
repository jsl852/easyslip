<script lang="ts">
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Categories</h1>
    <p class="sub">Keyword rules and the model choose a category. The category decides which revenue or expense account the journal debits or credits.</p>
  </div>
</div>
{#if form?.message}<p class="callout">{form.message}</p>{/if}

<form method="POST" action="?/create" class="card fields two">
  <label><span>Name</span><input name="name" required maxlength="80" /></label>
  <label>
    <span>Kind</span>
    <select name="kind">
      <option value="expense">Expense</option>
      <option value="cogs">Cost of sales</option>
      <option value="revenue">Revenue</option>
    </select>
  </label>
  <label>
    <span>Posts to</span>
    <select name="accountId">
      {#each data.accounts as account (account.id)}
        <option value={account.id}>{account.code} {account.name}</option>
      {/each}
    </select>
  </label>
  <div class="actions"><button type="submit">Add category</button></div>
</form>

<div class="stack" style="margin-top: 1rem;">
  {#each data.categories as category (category.id)}
    <form method="POST" action="?/update" class="card fields two">
      <input type="hidden" name="id" value={category.id} />
      <label><span>Name</span><input name="name" value={category.name} required maxlength="80" /></label>
      <label>
        <span>Kind</span>
        <select name="kind">
          <option value="expense" selected={category.kind === "expense"}>Expense</option>
          <option value="cogs" selected={category.kind === "cogs"}>Cost of sales</option>
          <option value="revenue" selected={category.kind === "revenue"}>Revenue</option>
        </select>
      </label>
      <label>
        <span>Posts to</span>
        <select name="accountId">
          {#each data.accounts as account (account.id)}
            <option value={account.id} selected={account.id === category.accountId}>{account.code} {account.name}</option>
          {/each}
        </select>
      </label>
      <label><span>Active</span><input name="active" type="checkbox" checked={category.active} /></label>
      <button class="secondary" type="submit">Save</button>
    </form>
  {/each}
</div>
