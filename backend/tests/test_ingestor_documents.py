from pathlib import Path
import zipfile

from profile import ingestor


def test_document_reads_plain_text_resume(tmp_path):
    resume = tmp_path / "resume.txt"
    resume.write_text("name: Jane Doe\nsummary: Applied AI engineer", encoding="utf-8")

    assert "Jane Doe" in ingestor._document(str(resume))


def test_document_reads_markdown_resume(tmp_path):
    resume = tmp_path / "resume.md"
    resume.write_text("# Jane Doe\n\nPython, FastAPI", encoding="utf-8")

    assert "FastAPI" in ingestor._document(str(resume))


def test_document_reads_docx_resume(tmp_path):
    resume = tmp_path / "resume.docx"
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>Applied AI engineer</w:t></w:r></w:p></w:body></w:document>"
    )
    with zipfile.ZipFile(resume, "w") as archive:
        archive.writestr("word/document.xml", document_xml)

    text = ingestor._document(str(resume))

    assert "Jane Doe" in text
    assert "Applied AI engineer" in text


def test_local_parser_extracts_normal_resume_without_llm():
    profile = ingestor._parse_local(
        """
Jane Doe
jane@example.com | https://github.com/jane

Summary
Applied AI engineer building FastAPI and React products.

Skills
Python, FastAPI, React, PostgreSQL, Docker

Experience
AI Engineer at Acme
- Built LangGraph workflows.

Projects
Hiring Agent - FastAPI, React, RAG job matching
"""
    )

    assert profile.n == "Jane Doe"
    assert any(skill.n == "Python" for skill in profile.skills)
    assert any(skill.n == "FastAPI" for skill in profile.skills)
    assert profile.exp
    assert profile.projects


def test_local_parser_does_not_store_contacts_as_summary():
    profile = ingestor._parse_local(
        """
Komalpreet Kaur
kaurkomalpreetsohal@gmail.com | +91 9451735039
https://github.com/Komalpreet2809/Vanta
https://github.com/Komalpreet2809/SOMA

Skills
Python, FastAPI, React
"""
    )

    assert "Email:" not in profile.s
    assert "Phone:" not in profile.s
    assert "Links:" not in profile.s
    assert "github.com" not in profile.s


def test_local_parser_repairs_project_titles_and_certificates():
    profile = ingestor._parse_local(
        """
Komalpreet Kaur

Skills
Python, FastAPI, React, Playwright

Projects
conditioning. - https://github.com/Komalpreet2809/Vanta
- Deployed FastAPI backend on Hugging Face Spaces and Next.js frontend on Vercel.
APIs. - Playwright | https://github.com/Komalpreet2809/Specula
- Built Chrome extension for Pinterest outfit segmentation with Python and FastAPI.

Certificates
Social Networks
Jan2025 - Apr 2025
NPTEL -- Certificate Link
"""
    )

    titles = [project.title for project in profile.projects]
    assert "Vanta" in titles
    assert "Specula" in titles
    assert "conditioning" not in {title.lower() for title in titles}
    assert "apis" not in {title.lower() for title in titles}
    assert profile.certifications == ["Social Networks - NPTEL Jan 2025 - Apr 2025"]
