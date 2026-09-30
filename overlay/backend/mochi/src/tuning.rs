use sysinfo::{Disks, System};
use std::fs;

pub struct MochiTuning {
    pub worker_threads: usize,
    pub cache_capacity_bytes: u64,
    pub cache_ttl_secs: u64,
    pub max_cache_entry_size: usize,
    pub ram_cache_limit: usize,
    pub pool_idle_per_host_asset: usize,
    pub pool_idle_per_host_html: usize,
    pub pool_idle_timeout_secs: u64,
    pub request_permits: usize,
    pub html_rewrite_permits: usize,
    pub disk_cache_bytes: u64,
    pub disk_max_age_secs: u64,
    pub disk_cleanup_interval_secs: u64,
    pub channel_buffer: usize,
}

pub fn detect() -> MochiTuning {
    let mut sys = System::new();
    sys.refresh_memory();
    let host_ram_mb = sys.total_memory() / (1024 * 1024);
    // sysinfo can report the host's RAM inside a memory-limited container.
    // Allocate from the container budget (and a smaller explicit Mochi budget)
    // so the proxy does not compete with the Node server for all free-tier RAM.
    let cgroup_ram_mb = container_memory_mb().unwrap_or(host_ram_mb);
    let ram_mb = env_number("MOCHI_MEMORY_MB")
        .unwrap_or(cgroup_ram_mb)
        .min(cgroup_ram_mb)
        .min(host_ram_mb)
        .max(32);
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);

    let disks = Disks::new_with_refreshed_list();
    let disk_mb = disks
        .list()
        .iter()
        .map(|d| d.available_space() / (1024 * 1024))
        .max()
        .unwrap_or(10_000);

    tracing::info!(
        "detected system: {}MB RAM, {} cores, {}MB disk",
        ram_mb,
        cores,
        disk_mb
    );

    let mut tuning = compute(ram_mb, cores, disk_mb);
    if let Some(cache_mb) = env_number("MOCHI_CACHE_MB") {
        let cache_mb = cache_mb.clamp(4, (ram_mb / 4).max(4));
        tuning.cache_capacity_bytes = cache_mb * 1024 * 1024;
        tuning.max_cache_entry_size = ((cache_mb / 8).clamp(1, 16) as usize) * 1024 * 1024;
        tuning.ram_cache_limit = ((cache_mb / 2).clamp(4, 32) as usize) * 1024 * 1024;
    }
    if let Some(disk_mb) = env_number("MOCHI_DISK_CACHE_MB") {
        tuning.disk_cache_bytes = disk_mb.clamp(32, 81920) * 1024 * 1024;
    }
    if let Some(workers) = env_number("MOCHI_WORKERS") {
        tuning.worker_threads = workers.clamp(1, 6) as usize;
    }
    if ram_mb <= 512 {
        tuning.request_permits = 24;
        tuning.html_rewrite_permits = 4;
        tuning.channel_buffer = 8;
        tuning.pool_idle_per_host_asset = 4;
        tuning.pool_idle_per_host_html = 2;
    }
    tuning
}

fn env_number(name: &str) -> Option<u64> {
    std::env::var(name).ok()?.trim().parse::<u64>().ok().filter(|n| *n > 0)
}

fn container_memory_mb() -> Option<u64> {
    ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]
        .iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .filter_map(|raw| raw.trim().parse::<u64>().ok())
        // cgroup v1 uses a huge sentinel for an unlimited container.
        .filter(|bytes| *bytes > 0 && *bytes < (1u64 << 60))
        .map(|bytes| bytes / (1024 * 1024))
        .min()
}

fn compute(ram_mb: u64, cores: usize, disk_mb: u64) -> MochiTuning {
    let worker_threads = cores.saturating_sub(1).max(2).min(6);

    let cache_cap_mb = (ram_mb / 128).max(32).min(256);
    let cache_capacity_bytes = cache_cap_mb * 1024 * 1024;

    let max_entry_mb = (cache_cap_mb / 8).max(4).min(16);
    let max_cache_entry_size = (max_entry_mb as usize) * 1024 * 1024;

    let ram_limit_mb = (cache_cap_mb / 8).max(16).min(32);
    let ram_cache_limit = (ram_limit_mb as usize) * 1024 * 1024;

    let cache_ttl_secs = if ram_mb < 8192 { 36 * 3600 } else { 72 * 3600 };

    let pool_idle_per_host_asset = (cores * 3).max(4).min(24);
    let pool_idle_per_host_html = (cores * 2).max(2).min(12);
    let pool_idle_timeout_secs = if ram_mb < 8192 { 120 } else { 240 };

    let request_permits = (cores * 24).max(64).min(256);
    let html_rewrite_permits = (cores * 8).max(8).min(64);

    let disk_cache_gb = (disk_mb / 1024 / 20).max(2).min(80);
    let disk_cache_bytes = disk_cache_gb * 1024 * 1024 * 1024;
    let disk_max_age_secs = if disk_mb < 100_000 {
        72 * 3600
    } else {
        7 * 24 * 3600
    };
    let disk_cleanup_interval_secs = if disk_mb < 100_000 { 1800 } else { 3600 };

    let channel_buffer = if ram_mb < 8192 { 16 } else { 24 };

    MochiTuning {
        worker_threads,
        cache_capacity_bytes,
        cache_ttl_secs,
        max_cache_entry_size,
        ram_cache_limit,
        pool_idle_per_host_asset,
        pool_idle_per_host_html,
        pool_idle_timeout_secs,
        request_permits,
        html_rewrite_permits,
        disk_cache_bytes,
        disk_max_age_secs,
        disk_cleanup_interval_secs,
        channel_buffer,
    }
}
