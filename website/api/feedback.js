import { json, send } from "./_counter.js";

const DEFAULT_REPO = "vasu-devs/JustHireMe";
const VALID_KINDS = new Set(["feedback", "review"]);

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanMultiline(value, limit) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, limit);
}

function issueTitle(kind, name, rating) {
  const prefix = kind === "review" ? "Website review" : "Website feedback";
  const byline = name ? ` from ${name}` : "";
  const score = kind === "review" && rating ? ` (${rating}/5)` : "";
  return `${prefix}${score}${byline}`;
}

function buildBody({ kind, name, email, rating, message, path, userAgent }) {
  const lines = [
    `Kind: ${kind}`,
    name ? `Name: ${name}` : null,
    email ? `Email: ${email}` : null,
    kind === "review" && rating ? `Rating: ${rating}/5` : null,
    path ? `Page: ${path}` : null,
    "",
    message,
    "",
    "---",
    userAgent ? `User agent: ${userAgent}` : null,
  ].filter((line) => line !== null);

  return lines.join("\n");
}

async function addIssueLabels(repo, issueNumber, token, kind) {
  const labels = ["website-feedback", kind === "review" ? "review" : "feedback"];

  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "justhireme-website",
    },
    body: JSON.stringify({ labels }),
  });

  if (!response.ok) {
    return false;
  }

  return true;
}

async function createGitHubIssue(payload) {
  const token = process.env.GITHUB_FEEDBACK_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_FEEDBACK_REPO || DEFAULT_REPO;

  if (!token) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "justhireme-website",
    },
    body: JSON.stringify({
      title: issueTitle(payload.kind, payload.name, payload.rating),
      body: buildBody(payload),
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub issue creation failed with ${response.status}`);
  }

  const issue = await response.json();
  const labeled = await addIssueLabels(repo, issue.number, token, payload.kind).catch(() => false);
  return { provider: "github", url: issue.html_url, labeled };
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_EMAIL_TO;
  const from = process.env.FEEDBACK_EMAIL_FROM || "JustHireMe <onboarding@resend.dev>";

  if (!apiKey || !to) {
    return null;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: issueTitle(payload.kind, payload.name, payload.rating),
      text: buildBody(payload),
      reply_to: payload.email || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed with ${response.status}`);
  }

  const email = await response.json();
  return { provider: "email", id: email.id };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return send(response, json({ error: "Method not allowed" }, 405));
  }

  try {
    const body = typeof request.body === "object" && request.body ? request.body : {};

    if (body.website) {
      return send(response, json({ delivered: true, ignored: true }));
    }

    const kind = VALID_KINDS.has(body.kind) ? body.kind : "feedback";
    const message = cleanMultiline(body.message, 5000);
    const rating = Math.max(1, Math.min(5, Number.parseInt(body.rating || "0", 10) || 0));

    if (message.length < 8) {
      return send(response, json({ error: "Please add a little more detail." }, 400));
    }

    const payload = {
      kind,
      name: cleanText(body.name, 120),
      email: cleanText(body.email, 160),
      rating: kind === "review" ? rating : null,
      message,
      path: cleanText(body.path, 220),
      userAgent: cleanText(body.userAgent, 320),
    };

    const results = await Promise.allSettled([
      createGitHubIssue(payload),
      sendEmail(payload),
    ]);
    const deliveries = results
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const failures = results.filter((result) => result.status === "rejected");

    if (deliveries.length === 0 && failures.length > 0) {
      return send(response, json({ error: "Feedback delivery is unavailable right now." }, 500));
    }

    return send(response, json({
      delivered: deliveries.length > 0,
      deliveries,
      configured: deliveries.length > 0,
    }, deliveries.length > 0 ? 200 : 202));
  } catch (error) {
    return send(response, json({ error: "Feedback delivery is unavailable right now." }, 500));
  }
}
