# Pitole — obraz aplikacji do developmentu lokalnego (docker compose up).
# Produkcja (OVH) NIE używa Dockera — tam wgrywa się pliki przez FTP
# (patrz docs/deployment-ovh.md).
#
# Układ w kontenerze:
#   /var/www/html  = zawartość public/  (DocumentRoot)
#   /var/www/api   = backend, wystawiony pod URL /api przez Apache Alias
# Dzięki temu bind-mounty w docker-compose.yml się NIE zagnieżdżają
# (zagnieżdżone mounty tworzyły śmieciowe pliki-stuby na hoście w public/api/).
# Z punktu widzenia frontendu URL jest ten sam co na OVH: api/index.php?r=...

FROM php:8.2-apache

# Baza: SQLite (pdo_sqlite jest już w obrazie bazowym — jak na produkcji OVH).
# Żadnego serwera bazy ani dodatkowych sterowników nie instalujemy.

# API poza DocumentRoot, dostępne pod /api (handler PHP z obrazu działa globalnie)
RUN printf 'Alias /api /var/www/api\n<Directory /var/www/api>\n    Require all granted\n</Directory>\n' \
      > /etc/apache2/conf-enabled/pitole-api.conf

# Baseline plików w obrazie; docker-compose montuje na wierzch żywe pliki z hosta
# (edycja kodu bez przebudowy obrazu).
COPY public/ /var/www/html/
COPY api/index.php api/db.php /var/www/api/

# config.php jest dostarczany przez wolumen w docker-compose.yml
# (docker/config.docker.php) — nie wypiekamy sekretów w obraz.
