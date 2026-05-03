FROM nginx:alpine

# apache2-utils provides htpasswd, used by the entrypoint to materialize
# /etc/nginx/.htpasswd from ADMIN_USER/ADMIN_PASSWORD at container start.
RUN apk add --no-cache apache2-utils

COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /usr/local/bin/admin-entrypoint.sh
RUN chmod +x /usr/local/bin/admin-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/admin-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
