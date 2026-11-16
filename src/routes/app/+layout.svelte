<script lang="ts">
  import { page } from "$app/stores";
  let { data, children } = $props();

  const groups = [
    {
      label: "Work",
      links: [
        { href: "/app", label: "Overview" },
        { href: "/app/upload", label: "Upload" },
        { href: "/app/review", label: "Review", badge: true }
      ]
    },
    {
      label: "Books",
      links: [
        { href: "/app/transactions?type=expense", label: "Expenses" },
        { href: "/app/transactions?type=purchase", label: "Purchases" },
        { href: "/app/transactions?type=sales", label: "Sales" },
        { href: "/app/journal", label: "Journal" },
        { href: "/app/transactions/new", label: "Manual entry" }
      ]
    },
    {
      label: "Close",
      links: [
        { href: "/app/reports", label: "Reports" },
        { href: "/app/accounts", label: "Chart of accounts" },
        { href: "/app/categories", label: "Categories" },
        { href: "/app/rules", label: "Keyword rules" },
        { href: "/app/openings", label: "Opening balances" },
        { href: "/app/settings", label: "Company" }
      ]
    }
  ];

  function current(href: string, path: string, search: string) {
    if (href === "/app") return path === "/app";
    const [pathname, query = ""] = href.split("?");
    if (pathname !== path) return false;
    if (!query) return search === "";
    return search === `?${query}`;
  }
</script>

<div class="app-shell">
  <details class="side" open>
    <summary>Menu</summary>
    <div class="side-top">
      <a class="wordmark brand" href="/app"><span class="mark">E</span>EasySlip</a>
      <div class="company-name">{data.workspace.company.name}</div>
      <div class="who">{data.workspace.userEmail}</div>
    </div>
    <nav class="nav-links" aria-label="Workspace">
      {#each groups as group (group.label)}
        <span class="group">{group.label}</span>
        {#each group.links as link (link.href)}
          <a href={link.href} aria-current={current(link.href, $page.url.pathname, $page.url.search) ? "page" : undefined}>
            {link.label}
            {#if link.badge && data.counts.review > 0}<span class="badge">{data.counts.review}</span>{/if}
          </a>
        {/each}
      {/each}
    </nav>
    <form method="POST" action="/signout" style="margin-top: 1rem;">
      <input type="hidden" name="redirectTo" value="/" />
      <button class="secondary" type="submit">Sign out</button>
    </form>
  </details>
  <main class="main" id="content">
    {@render children()}
  </main>
</div>
