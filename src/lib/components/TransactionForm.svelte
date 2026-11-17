<script lang="ts">
  import { enhance } from "$app/forms";

  type Account = { id: string; code: string; name: string };
  type Category = { id: string; name: string; kind: string };

  let {
    values,
    accounts,
    categories,
    approve = false
  }: {
    values: {
      type: string;
      txnDate: string;
      merchant: string;
      description: string;
      amount: string;
      settlementAccountId: string;
      categoryId: string;
    };
    accounts: Account[];
    categories: Category[];
    approve?: boolean;
  } = $props();

  let pending = $state(false);
</script>

<form
  method="POST"
  class="stack"
  use:enhance={() => {
    pending = true;
    return async ({ update }) => {
      pending = false;
      await update();
    };
  }}
>
  <div class="fields two">
    <label>
      <span>Type</span>
      <select name="type" value={values.type}>
        <option value="expense">Expense</option>
        <option value="purchase">Purchase</option>
        <option value="sales">Sales</option>
      </select>
    </label>
    <label>
      <span>Date</span>
      <input name="txnDate" type="date" required value={values.txnDate} />
    </label>
    <label>
      <span>Settlement account</span>
      <select name="settlementAccountId" required value={values.settlementAccountId}>
        {#each accounts as account (account.id)}
          <option value={account.id}>{account.code} {account.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Category</span>
      <select name="categoryId" required value={values.categoryId}>
        {#each categories as category (category.id)}
          <option value={category.id}>{category.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Amount (HKD)</span>
      <input name="amount" inputmode="decimal" required value={values.amount} />
    </label>
    <label>
      <span>Merchant</span>
      <input name="merchant" value={values.merchant} maxlength="200" />
    </label>
  </div>
  <label>
    <span>Description</span>
    <textarea name="description" required maxlength="500">{values.description}</textarea>
  </label>
  <div class="actions">
    <button name="intent" value="save" disabled={pending}>{pending ? "Saving…" : approve ? "Save corrections" : "Post to the journal"}</button>
    {#if approve}
      <button class="stamp" name="intent" value="approve" disabled={pending}>Approve</button>
    {/if}
  </div>
</form>
