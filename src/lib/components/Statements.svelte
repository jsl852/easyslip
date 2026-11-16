<script lang="ts">
  import { formatCents } from "$lib/accounting/format";
  import type { Statements, TrialRow } from "$lib/accounting/types";

  let { statements }: { statements: Statements } = $props();

  function rows(items: TrialRow[], pick: (row: TrialRow) => number) {
    return items.filter((row) => pick(row) !== 0);
  }
</script>

<div class="stack">
  <section>
    <h2>Profit and loss</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>
          {#each rows(statements.profitAndLoss.revenue, (row) => row.periodNaturalCents) as row (row.account.id)}
            <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.periodNaturalCents)}</td></tr>
          {/each}
          <tr class="statement-total"><td>Total revenue</td><td class="num">{formatCents(statements.profitAndLoss.totalRevenueCents)}</td></tr>
          {#each rows(statements.profitAndLoss.cogs, (row) => row.periodNaturalCents) as row (row.account.id)}
            <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.periodNaturalCents)}</td></tr>
          {/each}
          <tr class="statement-total"><td>Total cost of sales</td><td class="num">{formatCents(statements.profitAndLoss.totalCogsCents)}</td></tr>
          <tr><td>Gross profit</td><td class="num">{formatCents(statements.profitAndLoss.grossProfitCents)}</td></tr>
          {#each rows(statements.profitAndLoss.expenses, (row) => row.periodNaturalCents) as row (row.account.id)}
            <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.periodNaturalCents)}</td></tr>
          {/each}
          <tr class="statement-total"><td>Total expenses</td><td class="num">{formatCents(statements.profitAndLoss.totalExpenseCents)}</td></tr>
          <tr class="statement-grand"><td>Net income</td><td class="num">{formatCents(statements.profitAndLoss.netIncomeCents)}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Balance sheet</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Account</th><th class="num">Balance</th></tr></thead>
        <tbody>
          {#each statements.balanceSheet.assets as row (row.account.id)}
            {#if row.naturalClosingCents !== 0}
              <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.naturalClosingCents)}</td></tr>
            {/if}
          {/each}
          <tr class="statement-total"><td>Total assets</td><td class="num">{formatCents(statements.balanceSheet.totalAssetsCents)}</td></tr>
          {#each statements.balanceSheet.liabilities as row (row.account.id)}
            {#if row.naturalClosingCents !== 0}
              <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.naturalClosingCents)}</td></tr>
            {/if}
          {/each}
          <tr class="statement-total"><td>Total liabilities</td><td class="num">{formatCents(statements.balanceSheet.totalLiabilitiesCents)}</td></tr>
          {#each statements.balanceSheet.equity as row (row.account.id)}
            {#if row.naturalClosingCents !== 0}
              <tr><td>{row.account.code} {row.account.name}</td><td class="num">{formatCents(row.naturalClosingCents)}</td></tr>
            {/if}
          {/each}
          <tr><td>Prior unclosed results</td><td class="num">{formatCents(statements.balanceSheet.priorUnclosedCents)}</td></tr>
          <tr><td>Current period earnings</td><td class="num">{formatCents(statements.balanceSheet.currentEarningsCents)}</td></tr>
          <tr class="statement-grand"><td>Total liabilities and equity</td><td class="num">{formatCents(statements.balanceSheet.totalLiabilitiesAndEquityCents)}</td></tr>
          <tr><td>Balance check</td><td class="num">{formatCents(statements.balanceSheet.balanceCheckCents)}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Trial balance</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Account</th>
            <th class="num">Opening Dr</th><th class="num">Opening Cr</th>
            <th class="num">Period Dr</th><th class="num">Period Cr</th>
            <th class="num">Closing</th>
          </tr>
        </thead>
        <tbody>
          {#each statements.trialBalance as row (row.account.id)}
            {#if row.openingCents !== 0 || row.periodDebitCents !== 0 || row.periodCreditCents !== 0}
              <tr>
                <td>{row.account.code}</td>
                <td>{row.account.name}</td>
                <td class="num">{formatCents(row.openingDebitCents)}</td>
                <td class="num">{formatCents(row.openingCreditCents)}</td>
                <td class="num">{formatCents(row.periodDebitCents)}</td>
                <td class="num">{formatCents(row.periodCreditCents)}</td>
                <td class="num">{formatCents(row.naturalClosingCents)}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>
