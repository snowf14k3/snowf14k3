import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPaths = {
  light: resolve("assets/profile-light.svg"),
  dark: resolve("assets/profile-dark.svg"),
};
const username = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER || "snowf14k3";
const token = process.env.GH_TOKEN;

const themes = {
  light: {
    text: "#24292F",
    muted: "#57606A",
    green: "#1A7F37",
    blue: "#0969DA",
    cyan: "#0A7B83",
    yellow: "#9A6700",
    magenta: "#8250DF",
    heatmap: ["#EBEDF0", "#9BE9A8", "#40C463", "#30A14E", "#216E39"],
  },
  dark: {
    text: "#C9D1D9",
    muted: "#8B949E",
    green: "#3FB950",
    blue: "#58A6FF",
    cyan: "#39C5CF",
    yellow: "#D29922",
    magenta: "#BC8CFF",
    heatmap: ["#21262D", "#0E4429", "#006D32", "#26A641", "#39D353"],
  },
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} UTC+8`;
}

function sumContributions(weeks) {
  return weeks.reduce(
    (total, { contributionDays }) =>
      total + contributionDays.reduce((weekTotal, { contributionCount }) => weekTotal + contributionCount, 0),
    0,
  );
}

async function fetchProfileData() {
  if (!token) {
    throw new Error("GH_TOKEN is required. Set it from the SUMMARY_GITHUB_TOKEN repository secret.");
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 364);

  const query = `
    query ProfileStatus($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        createdAt
        repositories(
          first: 100
          ownerAffiliations: [OWNER]
          privacy: PUBLIC
          isFork: false
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          totalCount
          nodes {
            stargazerCount
          }
        }
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalRepositoriesWithContributedCommits
          commitContributionsByRepository(maxRepositories: 100) {
            repository {
              primaryLanguage {
                name
                color
              }
              languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
                edges {
                  size
                  node {
                    name
                    color
                  }
                }
              }
            }
            contributions {
              totalCount
            }
          }
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${username}-profile-renderer`,
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map(({ message }) => message).join("; ")}`);
  }

  const user = payload.data?.user;
  if (!user) {
    throw new Error(`GitHub user ${username} was not found.`);
  }

  const languageMap = new Map();
  const profileLanguageMap = new Map();
  const contributionsCollection = user.contributionsCollection;

  for (const { repository, contributions } of contributionsCollection.commitContributionsByRepository) {
    for (const { size, node: repositoryLanguage } of repository.languages.edges) {
      if (!repositoryLanguage?.name || repositoryLanguage.name.toLowerCase() === "html") continue;
      const current = profileLanguageMap.get(repositoryLanguage.name) || {
        size: 0,
        color: repositoryLanguage.color,
      };
      current.size += size;
      current.color ||= repositoryLanguage.color;
      profileLanguageMap.set(repositoryLanguage.name, current);
    }

    const language = repository.primaryLanguage;
    if (!language?.name || language.name.toLowerCase() === "html") continue;
    const current = languageMap.get(language.name) || { commits: 0, color: language.color };
    current.commits += contributions.totalCount;
    current.color ||= language.color;
    languageMap.set(language.name, current);
  }

  const languages = [...languageMap]
    .map(([name, { commits, color }]) => ({ name, commits, color }))
    .sort((left, right) => right.commits - left.commits)
    .slice(0, 5);
  const profileLanguages = [...profileLanguageMap]
    .map(([name, { size, color }]) => ({ name, size, color }))
    .sort((left, right) => right.size - left.size)
    .slice(0, 10);

  const weeks = contributionsCollection.contributionCalendar.weeks;

  return {
    contributions: sumContributions(weeks),
    repositories: user.repositories.totalCount,
    stars: user.repositories.nodes.reduce((total, repository) => total + repository.stargazerCount, 0),
    commits: contributionsCollection.totalCommitContributions,
    pullRequests: contributionsCollection.totalPullRequestContributions,
    issues: contributionsCollection.totalIssueContributions,
    contributedRepositories: contributionsCollection.totalRepositoriesWithContributedCommits,
    joinedYear: new Date(user.createdAt).getUTCFullYear(),
    weeks,
    languages,
    profileLanguages,
  };
}

function straightPath(points) {
  if (points.length < 2) return "";
  return points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

function renderContributionCurve(weeks, theme) {
  const weeklyTotals = weeks.map(({ contributionDays }) =>
    contributionDays.reduce((total, { contributionCount }) => total + contributionCount, 0),
  );
  const chart = { x: 435, y: 178, width: 443, height: 65 };
  const maximum = Math.max(1, ...weeklyTotals);
  const points = weeklyTotals.map((total, index) => ({
    x: chart.x + (index / Math.max(1, weeklyTotals.length - 1)) * chart.width,
    y: chart.y + chart.height - (total / maximum) * chart.height,
  }));
  const line = straightPath(points);
  const area = `${line} L ${points.at(-1).x.toFixed(2)} ${(chart.y + chart.height).toFixed(2)} L ${points[0].x.toFixed(2)} ${(chart.y + chart.height).toFixed(2)} Z`;
  const labelIndexes = [0, 10, 20, 30, 40, weeks.length - 1].filter(
    (index, position, indexes) => index >= 0 && index < weeks.length && indexes.indexOf(index) === position,
  );
  const labels = labelIndexes
    .map((index) => {
      const date = weeks[index].contributionDays[0]?.date;
      if (!date) return "";
      const label = date.slice(2, 7).replace("-", "/");
      const x = chart.x + (index / Math.max(1, weeks.length - 1)) * chart.width;
      const anchor = index === 0 ? "start" : index === weeks.length - 1 ? "end" : "middle";
      return `<text x="${x.toFixed(2)}" y="258" text-anchor="${anchor}" class="utility" fill="${theme.muted}">${label}</text>`;
    })
    .join("");

  return `
    <path d="${area}" fill="${theme.green}" fill-opacity="0.16" />
    <path d="${line}" fill="none" stroke="${theme.green}" stroke-width="2" />
    <line x1="${chart.x}" y1="${chart.y + chart.height}" x2="${chart.x + chart.width}" y2="${chart.y + chart.height}" stroke="${theme.muted}" stroke-opacity="0.45" />
    ${labels}
  `;
}

function renderLanguageBar(languages, theme) {
  if (languages.length === 0) {
    return `<text x="18" y="323" class="body" fill="${theme.muted}">(no language data)</text>`;
  }

  const total = languages.reduce((sum, { commits }) => sum + commits, 0);
  return languages
    .map(({ name, commits, color }, index) => {
      const percent = Math.round((commits / total) * 100);
      const filled = Math.max(1, Math.round((percent / 100) * 28));
      const filledBar = "█".repeat(filled);
      const emptyBar = "█".repeat(28 - filled);
      const languageColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color : theme.green;
      const y = 323 + index * 20;
      return `
        <text x="18" y="${y}" class="body" fill="${theme.text}">${escapeXml(name)}</text>
        <text x="145" y="${y}" class="body"><tspan fill="${languageColor}">${filledBar}</tspan><tspan fill="${theme.muted}" fill-opacity="0.18">${emptyBar}</tspan></text>
        <text x="430" y="${y}" class="body" fill="${theme.muted}">${percent}%</text>
      `;
    })
    .join("");
}

function renderProfileLanguages(languages, theme) {
  if (languages.length === 0) {
    return `<text x="520" y="52" class="body" fill="${theme.muted}">(none)</text>`;
  }

  const renderRow = (row, y) => {
    const items = row
      .map(({ name, color }) => {
        const languageColor = /^#[0-9a-f]{6}$/i.test(color || "") ? color : theme.text;
        return `<tspan fill="${languageColor}">&quot;${escapeXml(name)}&quot;</tspan>`;
      })
      .join(`<tspan fill="${theme.text}"> </tspan>`);
    return `<text x="520" y="${y}" class="body">${items}</text>`;
  };

  const rows = [[], [], []];
  const rowLengths = [0, 0, 0];
  let rowIndex = 0;
  for (const language of languages) {
    const tokenLength = language.name.length + 2 + (rows[rowIndex].length ? 1 : 0);
    if (rowIndex < rows.length - 1 && rowLengths[rowIndex] + tokenLength > 39) rowIndex += 1;
    rows[rowIndex].push(language);
    rowLengths[rowIndex] += tokenLength;
  }

  return rows.map((row, index) => (row.length ? renderRow(row, 52 + index * 20) : "")).join("");
}

function renderTuiFrames(theme) {
  const stroke = `stroke="${theme.muted}" stroke-opacity="0.36" stroke-width="1" fill="none" shape-rendering="crispEdges"`;
  return `
    <path d="M 6 30 H 18 M 92 30 H 500 M 500 30 H 512 M 590 30 H 894 V 122 H 6 V 30 M 500 30 V 122" ${stroke} />
    <text x="24" y="34" class="utility" fill="${theme.cyan}">profile.d</text>
    <text x="518" y="34" class="utility" fill="${theme.magenta}">languages</text>

    <path d="M 6 154 H 18 M 110 154 H 420 M 420 154 H 430 M 540 154 H 894 V 264 H 6 V 154 M 420 154 V 264" ${stroke} />
    <text x="24" y="158" class="utility" fill="${theme.yellow}">metrics / 1y</text>
    <text x="436" y="158" class="utility" fill="${theme.green}">activity / 365d</text>

    <path d="M 6 296 H 18 M 150 296 H 478 V 414 H 6 V 296" ${stroke} />
    <text x="24" y="300" class="utility" fill="${theme.blue}">languages / commit</text>
  `;
}

function renderSvg(data, theme, mode) {
  const safeUsername = escapeXml(username);
  const syncedAt = escapeXml(formatTimestamp(new Date()));

  const prompt = (y, command = "", showCursor = false, x = 18) => `<text x="${x}" y="${y}" class="body"><tspan fill="${theme.green}">snowf14k3@github</tspan><tspan fill="${theme.text}">:</tspan><tspan fill="${theme.blue}">~</tspan><tspan fill="${theme.text}">$ ${escapeXml(command)}</tspan>${showCursor ? `<tspan fill="${theme.text}" class="cursor">█</tspan>` : ""}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="450" viewBox="0 0 900 450" role="img" aria-labelledby="title desc">
  <title id="title">${safeUsername} native shell profile (${mode})</title>
  <desc id="desc">A transparent native shell profile showing interests and live GitHub statistics.</desc>
  <style>
    .body { font-family: "Cascadia Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; font-size: 14px; font-variant-ligatures: none; }
    .utility { font-family: "Cascadia Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; font-size: 11px; font-variant-ligatures: none; }
    .cursor { animation: blink 1.1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .cursor { animation: none; } }
  </style>

  ${prompt(20, "cat /etc/profile.d/0x0AB8")}
  ${renderTuiFrames(theme).trim()}
  <text x="18" y="52" class="body" fill="${theme.text}">NAME=<tspan fill="${theme.cyan}">0x0AB8</tspan></text>
  <text x="18" y="72" class="body" fill="${theme.text}">ROLE=<tspan fill="${theme.blue}">&quot;Full-stack Developer&quot;</tspan></text>
  <text x="18" y="92" class="body" fill="${theme.text}">FOCUS=<tspan fill="${theme.yellow}">&quot;Learning &amp; Building&quot;</tspan></text>
  <text x="18" y="112" class="body" fill="${theme.text}">INTERESTS=(<tspan fill="${theme.magenta}">&quot;Reverse Engineering&quot;</tspan>)</text>
  ${renderProfileLanguages(data.profileLanguages, theme)}

  ${prompt(144, "./profile --stats --since=1y")}
  <text x="18" y="180" class="body" fill="${theme.text}">${formatNumber(data.contributions)}<tspan fill="${theme.muted}"> contributions</tspan></text>
  <text x="202" y="180" class="body" fill="${theme.text}">${formatNumber(data.commits)}<tspan fill="${theme.muted}"> commits / 1y</tspan></text>
  <text x="18" y="201" class="body" fill="${theme.text}">${formatNumber(data.repositories)}<tspan fill="${theme.muted}"> public repos</tspan></text>
  <text x="202" y="201" class="body" fill="${theme.text}">${formatNumber(data.pullRequests)}<tspan fill="${theme.muted}"> pull requests / 1y</tspan></text>
  <text x="18" y="222" class="body" fill="${theme.text}">${formatNumber(data.stars)}<tspan fill="${theme.muted}"> stars</tspan></text>
  <text x="202" y="222" class="body" fill="${theme.text}">${formatNumber(data.issues)}<tspan fill="${theme.muted}"> issues / 1y</tspan></text>
  <text x="18" y="243" class="body" fill="${theme.text}">${data.joinedYear}<tspan fill="${theme.muted}"> joined GitHub</tspan></text>
  <text x="202" y="243" class="body" fill="${theme.text}">${formatNumber(data.contributedRepositories)}<tspan fill="${theme.muted}"> contributed repos / 1y</tspan></text>
  ${renderContributionCurve(data.weeks, theme)}

  ${prompt(286, "./profile --languages-by-commit")}
  ${renderLanguageBar(data.languages, theme)}

  ${prompt(440, "", true)}
  <text x="882" y="440" text-anchor="end" class="utility" fill="${theme.muted}">updated ${syncedAt}</text>
</svg>
`;
}

const data = await fetchProfileData();

for (const [mode, outputPath] of Object.entries(outputPaths)) {
  const svg = renderSvg(data, themes[mode], mode);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
  console.log(`Rendered ${outputPath} for ${username}.`);
}
