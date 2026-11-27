"""recipients are called friends

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-27 09:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None

# Tables that link something to the people it goes to.
LINKS = ('event', 'share', 'package')


def _rename(old, new):
    """Rename the tables, columns, index and constraint from `old` to `new`. No data changes."""
    op.rename_table(f'{old}s', f'{new}s')
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(f'ALTER INDEX ix_{old}s_user_id RENAME TO ix_{new}s_user_id')
        op.execute(
            f'ALTER TABLE {new}s RENAME CONSTRAINT uq_{old}s_user_email TO uq_{new}s_user_email'
        )
    for link in LINKS:
        op.rename_table(f'{link}_{old}s', f'{link}_{new}s')
        op.alter_column(f'{link}_{new}s', f'{old}_id', new_column_name=f'{new}_id')
    # Who each send of a package went to
    op.alter_column('package_sends', f'{old}s', new_column_name=f'{new}s')


def upgrade():
    _rename('recipient', 'friend')


def downgrade():
    _rename('friend', 'recipient')
