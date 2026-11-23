"""packages

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-23 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('packages',
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('token', sa.String(length=64), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('packages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_packages_token'), ['token'], unique=True)
        batch_op.create_index(batch_op.f('ix_packages_user_id'), ['user_id'], unique=False)

    op.create_table('package_files',
    sa.Column('package_id', sa.Integer(), nullable=False),
    sa.Column('file_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['package_id'], ['packages.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('package_id', 'file_id')
    )
    op.create_table('package_folders',
    sa.Column('package_id', sa.Integer(), nullable=False),
    sa.Column('folder_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['folder_id'], ['folders.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['package_id'], ['packages.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('package_id', 'folder_id')
    )
    op.create_table('package_recipients',
    sa.Column('package_id', sa.Integer(), nullable=False),
    sa.Column('recipient_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['package_id'], ['packages.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recipient_id'], ['recipients.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('package_id', 'recipient_id')
    )
    op.create_table('package_sends',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('package_id', sa.Integer(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('recipients', sa.JSON(), nullable=False),
    sa.Column('items', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['package_id'], ['packages.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('package_sends', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_package_sends_package_id'), ['package_id'], unique=False)


def downgrade():
    with op.batch_alter_table('package_sends', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_package_sends_package_id'))

    op.drop_table('package_sends')
    op.drop_table('package_recipients')
    op.drop_table('package_folders')
    op.drop_table('package_files')
    with op.batch_alter_table('packages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_packages_user_id'))
        batch_op.drop_index(batch_op.f('ix_packages_token'))

    op.drop_table('packages')
