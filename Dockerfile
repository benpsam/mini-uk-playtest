FROM python:3.12-slim
WORKDIR /app
COPY Server/ ./Server/
COPY Web/ ./Web/
RUN useradd --uid 10001 --create-home miniuk
USER miniuk
ENV PYTHONUNBUFFERED=1 PORT=10000
EXPOSE 10000
CMD ["python", "Server/hosted.py"]
