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
