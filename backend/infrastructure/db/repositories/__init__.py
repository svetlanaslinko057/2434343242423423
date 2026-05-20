"""
Typed repositories over MongoDB collections.

ONE repository per collection. Single ownership boundary.

The audit (2026-05-19) showed db.modules is written by 14 files, db.users by
11 files, db.auto_actions by 7 files. This sprawl is the root cause of the
monolith — domain logic cannot evolve independently because schema is
implicitly co-owned.

The path to module boundaries STARTS by routing every write through these
repositories. Migration is incremental: legacy `db.modules.update_one(...)`
calls continue to work, new code uses `ModulesRepository`. The architecture
test `test_one_writer_per_collection` ratchets down on offenders over time.

Owner mapping (target — see audit §10):
  Collection                  Owner domain
  ──────────────────────────  ─────────────
  users                       identity
  projects                    projects
  modules                     work
  money_ledger_events         money
  qa_decisions                qa
  invoices                    money
  validation_campaigns        community
  events                      shared (event bus replay log)
"""

from .base import BaseRepository
from .users import UsersRepository
from .projects import ProjectsRepository
from .modules import ModulesRepository
from .money import MoneyRepository

__all__ = [
    "BaseRepository",
    "UsersRepository",
    "ProjectsRepository",
    "ModulesRepository",
    "MoneyRepository",
]
