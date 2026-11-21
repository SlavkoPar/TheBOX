import smtplib
import ssl
from email.message import EmailMessage

from flask import current_app


def send_email(to, subject, body):
    """Send a plain-text email over SMTP.

    With no SMTP_HOST configured (local development) the message is logged
    instead of sent, so confirmation links can be copied from the console.
    """
    cfg = current_app.config

    if not cfg["SMTP_HOST"]:
        current_app.logger.warning(
            "SMTP_HOST not set; email not sent.\nTo: %s\nSubject: %s\n\n%s", to, subject, body
        )
        return

    message = EmailMessage()
    message["From"] = cfg["MAIL_FROM"]
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    context = ssl.create_default_context()
    if cfg["SMTP_USE_SSL"]:
        smtp = smtplib.SMTP_SSL(cfg["SMTP_HOST"], cfg["SMTP_PORT"], timeout=10, context=context)
    else:
        smtp = smtplib.SMTP(cfg["SMTP_HOST"], cfg["SMTP_PORT"], timeout=10)

    with smtp:
        if cfg["SMTP_USE_TLS"] and not cfg["SMTP_USE_SSL"]:
            smtp.starttls(context=context)
        if cfg["SMTP_USERNAME"]:
            smtp.login(cfg["SMTP_USERNAME"], cfg["SMTP_PASSWORD"])
        smtp.send_message(message)
