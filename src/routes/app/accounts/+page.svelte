<script lang="ts">
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Chart of accounts</h1>
    <p class="sub">Settlement accounts are the bank, cash, card, and staff cash bands you can pick on upload. Categories post to revenue and expense accounts.</p>
  </div>
</div>
{#if form?.message}<p class="callout">{form.message}</p>{/if}

<form method="POST" action="?/create" class="card fields two">
  <label><span>Code</span><input name="code" required pattern={"\\d{3,8}"} placeholder="2210" /></label>
  <label><span>Name</span><input name="name" required maxlength="80" /></label>
  <label>
    <span>Type</span>
    <select name="type">
      <option value="asset">Asset</option>
      <option value="liability">Liability</option>
      <option value="equity">Equity</option>
      <option value="revenue">Revenue</option>
      <option value="expense">Expense</option>
    </select>
  </label>
  <label>
    <span>Subtype</span>
    <select name="subtype">
      <option value="general">General</option>
      <option value="bank">Bank</option>
      <option value="cash">Cash</option>
      <option value="card">Card</option>
      <option value="employee_band">Employee cash band</option>
      <option value="receivable">Receivable</option>
      <option value="payable">Payable</option>
    </select>
  </label>
  <label>
    <span>P&amp;L group (expenses)</span>
    <select name="plGroup">
      <option value="expense">Expense</option>
      <option value="cogs">Cost of sales</option>
    </select>
  </label>
  <label><span>Currency label</span><input name="currency" value="HKD" maxlength="3" /></label>
  <label><span>Staff name (cash bands)</span><input name="employeeLabel" maxlength="80" /></label>
  <label><span>Settlement account</span><input name="isSettlement" type="checkbox" /></label>
  <div class="actions"><button type="submit">Add account</button></div>
</form>

<div class="table-wrap" style="margin-top: 1rem;">
  <table>
    <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th></th></tr></thead>
    <tbody>
      {#each data.accounts as account (account.id)}
        <tr>
          <td>{account.code}</td>
          <td colspan="4">
            <form method="POST" action="?/update" class="fields two">
              <input type="hidden" name="id" value={account.id} />
              <input name="name" value={account.name} required maxlength="80" />
              <span class="sub">{account.type} · {account.subtype}{account.employeeLabel ? ` · ${account.employeeLabel}` : ""}</span>
              <label><span>Active</span><input name="active" type="checkbox" checked={account.active} /></label>
              <label><span>Settlement</span><input name="isSettlement" type="checkbox" checked={account.isSettlement} /></label>
              <button class="secondary" type="submit">Save</button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
