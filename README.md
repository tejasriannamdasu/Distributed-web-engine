# Distributed Web Crawling Engine

A scalable distributed web crawler that efficiently crawls thousands of web pages using multiple concurrent workers. The system utilizes Redis for priority queue management, Bloom Filters for URL deduplication, PostgreSQL for persistent storage, Cheerio for HTML parsing, and Docker for containerized deployment.

## Tech Stack
Node.js • Express.js • Redis • PostgreSQL • Docker • Cheerio

## Features
- Distributed concurrent web crawling
- Redis-based priority job queues
- Bloom Filter URL deduplication
- REST API for crawl management
- Persistent storage with PostgreSQL
- Dockerized deployment
