FROM php:8.3-fpm-alpine

RUN apk add --no-cache tzdata \
    && docker-php-ext-install pdo_mysql opcache \
    && mkdir -p /var/lib/php/sessions \
    && chown www-data:www-data /var/lib/php/sessions

COPY docker/php/php.ini /usr/local/etc/php/conf.d/99-qiboard.ini

WORKDIR /var/www/app

# Collector-Container läuft als www-data, damit beide Container identische Rechte haben
USER www-data

CMD ["php-fpm"]
