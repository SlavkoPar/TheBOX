"""Password-based encryption for documents.

Key: scrypt(password, random 16-byte salt) -> 256-bit key.
Cipher: AES-256-GCM with a random 12-byte nonce (authenticated, so a wrong
password or modified data is detected rather than producing garbage).
The password is never stored; without it the content cannot be recovered.
"""

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SALT_BYTES = 16
NONCE_BYTES = 12


class WrongPassword(Exception):
    pass


def _key(password, salt):
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(password.encode("utf-8"))


def encrypt(plaintext, password):
    """Return (ciphertext, salt, nonce)."""
    salt = os.urandom(SALT_BYTES)
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(_key(password, salt)).encrypt(nonce, plaintext, None)
    return ciphertext, salt, nonce


def decrypt(ciphertext, password, salt, nonce):
    try:
        return AESGCM(_key(password, salt)).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise WrongPassword() from None
