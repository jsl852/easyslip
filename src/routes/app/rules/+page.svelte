<script lang="ts">
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Keyword rules</h1>
    <p class="sub">A case-insensitive phrase in the merchant or description wins over the model's category. Higher priority wins when more than one phrase matches.</p>
  </div>
</div>
{#if form?.message}<p class="callout">{form.message}</p>{/if}

<form method="POST" action="?/create" class="card fields two">
  <label><span>Phrase</span><input name="pattern" required minlength="2" maxlength="80" placeholder="microsoft" /></label>
  <label>
    <span>Category</span>
    <select name="categoryId">
      {#each data.categories as category (category.id)}
        <option value={category.id}>{category.name}</option>
      {/each}
    </select>
  </label>
  <label><span>Priority</span><input name="priority" type="number" value="10" /></label>
  <div class="actions"><button type="submit">Add rule</button></div>
</form>

<form method="POST" action="?/test" class="card fields two" style="margin-top: 0.8rem;">
  <label><span>Try a description</span><input name="sample" value={form?.sample ?? "Microsoft 365 subscription"} /></label>
  <div class="actions">
    <button class="secondary" type="submit">Test rules</button>
    {#if form?.matched}<span>Result: {form.matched}</span>{/if}
  </div>
</form>

<div class="table-wrap" style="margin-top: 1rem;">
  <table>
    <thead><tr><th>Phrase</th><th>Category</th><th>Priority</th><th>State</th><th></th></tr></thead>
    <tbody>
      {#each data.rules as rule (rule.id)}
        <tr>
          <td>{rule.pattern}</td>
          <td>{rule.categoryName}</td>
          <td>{rule.priority}</td>
          <td><span class="pill {rule.active ? "approved" : "failed"}">{rule.active ? "Active" : "Off"}</span></td>
          <td class="actions">
            <form method="POST" action="?/toggle">
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="active" value={rule.active ? "false" : "true"} />
              <button class="secondary" type="submit">{rule.active ? "Turn off" : "Turn on"}</button>
            </form>
            <form method="POST" action="?/remove">
              <input type="hidden" name="id" value={rule.id} />
              <button class="secondary" type="submit">Delete</button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
