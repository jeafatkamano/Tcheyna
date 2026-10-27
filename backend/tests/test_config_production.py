"""La configuration de production refuse de démarrer sur une base ou des
secrets absents, courts ou publics (lot 1.10)."""
import pytest

from config import LONGUEUR_MIN_SECRET, ProductionConfig, TestingConfig

FORT_1 = "a" * LONGUEUR_MIN_SECRET
FORT_2 = "b" * (LONGUEUR_MIN_SECRET + 16)


@pytest.fixture
def env_prod(monkeypatch):
    """Environnement de production valide ; chaque test en retire un morceau."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/tcheyna")
    monkeypatch.setenv("SECRET_KEY", FORT_1)
    monkeypatch.setenv("JWT_SECRET_KEY", FORT_2)
    monkeypatch.delenv("OTP_HMAC_KEY", raising=False)
    return monkeypatch


def test_valeurs_fortes_acceptees_et_posees_sur_l_instance(env_prod):
    config = ProductionConfig()
    assert config.SECRET_KEY == FORT_1
    assert config.JWT_SECRET_KEY == FORT_2
    assert config.OTP_HMAC_KEY == ""


def test_database_url_toujours_exigee(env_prod):
    env_prod.delenv("DATABASE_URL")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        ProductionConfig()


@pytest.mark.parametrize("cle", ["SECRET_KEY", "JWT_SECRET_KEY"])
def test_secret_absent_refuse(env_prod, cle):
    env_prod.delenv(cle)
    with pytest.raises(RuntimeError, match=cle):
        ProductionConfig()


@pytest.mark.parametrize("cle", ["SECRET_KEY", "JWT_SECRET_KEY"])
def test_secret_trop_court_refuse(env_prod, cle):
    env_prod.setenv(cle, "x" * (LONGUEUR_MIN_SECRET - 1))
    with pytest.raises(RuntimeError, match=cle):
        ProductionConfig()


@pytest.mark.parametrize(
    "cle, publique",
    [
        ("SECRET_KEY", "dev-secret-a-changer-en-production"),
        ("JWT_SECRET_KEY", "dev-jwt-secret-a-changer"),
        ("SECRET_KEY", "changez-moi-en-production"),
        ("JWT_SECRET_KEY", "changez-moi-aussi-en-production"),
    ],
)
def test_valeur_publique_refusee(env_prod, cle, publique):
    env_prod.setenv(cle, publique)
    with pytest.raises(RuntimeError, match=cle):
        ProductionConfig()


def test_message_ne_cite_pas_la_valeur(env_prod):
    faible = "secret-faible-a-ne-pas-logguer"
    env_prod.setenv("JWT_SECRET_KEY", faible)
    with pytest.raises(RuntimeError) as erreur:
        ProductionConfig()
    assert faible not in str(erreur.value)


def test_otp_hmac_key_fournie_doit_etre_forte(env_prod):
    env_prod.setenv("OTP_HMAC_KEY", "court")
    with pytest.raises(RuntimeError, match="OTP_HMAC_KEY"):
        ProductionConfig()


def test_otp_hmac_key_forte_acceptee(env_prod):
    env_prod.setenv("OTP_HMAC_KEY", FORT_2)
    assert ProductionConfig().OTP_HMAC_KEY == FORT_2


def test_configuration_de_test_non_concernee(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    TestingConfig()


# ─── Jeton des tâches nocturnes (lot 1.25) ───────────────────

def test_jeton_des_taches_nocturnes_facultatif(env_prod):
    env_prod.delenv("TACHES_NOCTURNES_JETON", raising=False)
    assert ProductionConfig().TACHES_NOCTURNES_JETON == ""


@pytest.mark.parametrize("valeur", ["abc123", "x" * (LONGUEUR_MIN_SECRET - 1),
                                    "dev-secret-a-changer-en-production"])
def test_jeton_des_taches_nocturnes_fourni_doit_etre_fort(env_prod, valeur):
    env_prod.setenv("TACHES_NOCTURNES_JETON", valeur)
    with pytest.raises(RuntimeError, match="TACHES_NOCTURNES_JETON") as erreur:
        ProductionConfig()
    assert valeur not in str(erreur.value)


def test_jeton_des_taches_nocturnes_fort_accepte(env_prod):
    env_prod.setenv("TACHES_NOCTURNES_JETON", FORT_2)
    assert ProductionConfig().TACHES_NOCTURNES_JETON == FORT_2
