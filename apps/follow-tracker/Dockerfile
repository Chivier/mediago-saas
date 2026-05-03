# Reuses the bili-investigate Selenium-on-Linux pattern: install Chrome and
# matching chromedriver, then layer the FastAPI service on top. yt-dlp comes
# from PyPI, ffmpeg from apt for any future post-processing.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        wget curl gnupg unzip ca-certificates \
        ffmpeg \
        fonts-noto-cjk fonts-noto-color-emoji \
        # Chromium runtime deps
        libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
        libpangocairo-1.0-0 libpango-1.0-0 libcups2 libdrm2 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Chrome + matching chromedriver. amd64 → google-chrome-stable + the
# chrome-for-testing chromedriver (versions track each other). arm64
# falls back to debian's chromium + chromium-driver bundle.
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
        wget -q -O /tmp/google-key.pub https://dl-ssl.google.com/linux/linux_signing_key.pub && \
        gpg --dearmor < /tmp/google-key.pub > /usr/share/keyrings/google-chrome.gpg && \
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
            > /etc/apt/sources.list.d/google-chrome.list && \
        apt-get update && apt-get install -y --no-install-recommends google-chrome-stable && \
        CHROME_VERSION=$(google-chrome --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1) && \
        wget -q -O /tmp/chromedriver.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip" && \
        unzip -q /tmp/chromedriver.zip -d /tmp && \
        mv /tmp/chromedriver-linux64/chromedriver /usr/local/bin/ && \
        chmod +x /usr/local/bin/chromedriver && \
        rm -rf /tmp/chromedriver* /tmp/google-key.pub; \
    else \
        apt-get update && apt-get install -y --no-install-recommends chromium chromium-driver && \
        ln -sf /usr/bin/chromedriver /usr/local/bin/chromedriver; \
    fi && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8900

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8900"]
