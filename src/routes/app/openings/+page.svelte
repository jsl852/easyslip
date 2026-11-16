<script lang="ts">
  import { formatCents } from "$lib/accounting/format";
  import { toCents } from "$lib/accounting/money";
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Opening balances</h1>
    <p class="sub">
      An opening is the debit-positive balance at the start of its date. Later journal lines move it.
      Use a debit for assets and expenses, and a credit for liabilities, equity, and income, when you are migrating last year's books.
    </p>
  </div>
</div>
{#if form?.message}<p class="callout">{form.message}</p>{/if}
<p class={data.net === 0 ? "callout good" : "callout bad"}>
  Latest opening per account sums to {formatCents(data.net)}. A migrated trial balance should sum to zero before the period's journals.
</p>

<form method="POST" action="?/create" class="card fields two" style="margin-top: 0.8rem;">
  <label>
    <span>Account</span>
    <select name="accountId">
      {#each data.accounts as account (account.id)}
        <option value={account.id}>{account.code} {account.name}</option>
      {/each}
    </select>
  </label>
  <label><span>As of</span><input type="date" name="asOf" required value={data.today} /></label>
  <label>
    <span>Side</span>
    <select name="side">
      <option value="debit">Debit</option>
      <option value="credit">Credit</option>
    </select>
  </label>
  <label><span>Amount</span><input name="amount" inputmode="decimal" required placeholder="10000.00" /></label>
  <label><span>Note</span><input name="note" maxlength="240" placeholder="Migrated from prior workbook" /></label>
  <div class="actions"><button type="submit">Add opening</button></div>
</form>

<div class="table-wrap" style="margin-top: 1rem;">
  <table>
    <thead><tr><th>As of</th><th>Account</th><th>Side</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
    <tbody>
      {#each data.rows as row (row.id)}
        {@const cents = toCents(row.debitBalance)}
        <tr>
          <td>{row.asOf}</td>
          <td>{row.accountCode} {row.accountName}</td>
          <td>{cents >= 0 ? "Debit" : "Credit"}</td>
          <td class="num">{formatCents(Math.abs(cents))}</td>
          <td>{row.note}</td>
          <td>
            <form method="POST" action="?/remove">
              <input type="hidden" name="id" value={row.id} />
              <button class="secondary" type="submit">Remove</button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
