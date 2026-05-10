class JustHireMeError(Exception):
    """Base class for domain-level errors."""


class LeadNotFoundError(JustHireMeError):
    pass


class ProfileNotFoundError(JustHireMeError):
    pass


class IngestionError(JustHireMeError):
    pass


class ScoringError(JustHireMeError):
    pass


class GenerationError(JustHireMeError):
    pass


class DiscoveryError(JustHireMeError):
    pass


class ConfigurationError(JustHireMeError):
    pass

