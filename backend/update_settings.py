import sqlite3
import os

# Get path to database
b = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "JustHireMe")
db_path = os.path.join(b, "crm.db")

# Top AI companies job boards
boards = [
    "https://jobs.lever.co/openai",
    "https://jobs.lever.co/anthropic",
    "https://jobs.lever.co/mistral",
    "https://jobs.lever.co/perplexity",
    "https://jobs.lever.co/cohere",
    "https://jobs.lever.co/scale",
    "https://jobs.ashbyhq.com/langchain",
    "https://jobs.lever.co/pinecone",
    "https://jobs.lever.co/wandb",
    "https://jobs.lever.co/together",
    "https://jobs.ashbyhq.com/copy.ai",
    "https://jobs.lever.co/midjourney",
    "https://jobs.lever.co/character",
    "https://jobs.lever.co/replicate"
]

boards_str = ",".join(boards)

# Connect and update
conn = sqlite3.connect(db_path)
conn.execute("INSERT OR REPLACE INTO settings(key, val) VALUES(?, ?)", ("job_boards", boards_str))
# Ensure provider is nvidia as user has a key for it
conn.execute("INSERT OR REPLACE INTO settings(key, val) VALUES(?, ?)", ("llm_provider", "nvidia"))
conn.commit()
conn.close()

print(f"Successfully updated job boards with {len(boards)} AI companies.")
print(f"Set LLM Provider to 'nvidia'.")
