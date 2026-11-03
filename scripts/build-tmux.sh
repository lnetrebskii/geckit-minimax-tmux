#!/bin/sh
# Usage: build-tmux.sh darwin-arm64|darwin-x64|linux-x64|linux-arm64 <output>; Linux runs inside Alpine for a static result.
set -eu

target=$1
out=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
work=${WORK:-$(mktemp -d)}
prefix=$work/prefix

TMUX_VERSION=3.5a
LIBEVENT_VERSION=2.1.12-stable
NCURSES_VERSION=6.5
UTF8PROC_VERSION=2.9.0

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

fetch() {
  file=$work/$3
  [ -f "$file" ] || curl -fsSL -o "$file" "$1"
  [ "$(sha "$file")" = "$2" ] || { echo "checksum mismatch: $1" >&2; exit 1; }
  tar -xzf "$file" -C "$work"
}

fetch "https://github.com/tmux/tmux/releases/download/$TMUX_VERSION/tmux-$TMUX_VERSION.tar.gz" 16216bd0877170dfcc64157085ba9013610b12b082548c7c9542cc0103198951 tmux-$TMUX_VERSION.tar.gz
fetch "https://github.com/libevent/libevent/releases/download/release-$LIBEVENT_VERSION/libevent-$LIBEVENT_VERSION.tar.gz" 92e6de1be9ec176428fd2367677e61ceffc2ee1cb119035037a27d346b0403bb libevent-$LIBEVENT_VERSION.tar.gz

host=
export PKG_CONFIG_PATH=$prefix/lib/pkgconfig PKG_CONFIG_LIBDIR=$prefix/lib/pkgconfig
case $target in
  darwin-arm64|darwin-x64)
    arch=$([ "$target" = darwin-arm64 ] && echo arm64 || echo x86_64)
    [ "$(uname -m)" = "$arch" ] || host=--host=$([ "$arch" = arm64 ] && echo aarch64 || echo x86_64)-apple-darwin
    export CC="clang -arch $arch" CFLAGS="-O2 -mmacosx-version-min=11.0"
    fetch "https://github.com/JuliaStrings/utf8proc/archive/refs/tags/v$UTF8PROC_VERSION.tar.gz" 18c1626e9fc5a2e192311e36b3010bfc698078f692888940f1fa150547abb0c1 utf8proc-$UTF8PROC_VERSION.tar.gz
    (cd "$work/utf8proc-$UTF8PROC_VERSION" && make libutf8proc.a CC="$CC" CFLAGS="$CFLAGS" && mkdir -p "$prefix/lib" "$prefix/include" && cp libutf8proc.a "$prefix/lib/" && cp utf8proc.h "$prefix/include/")
    static=--enable-utf8proc
    ;;
  linux-x64|linux-arm64)
    fetch "https://ftp.gnu.org/gnu/ncurses/ncurses-$NCURSES_VERSION.tar.gz" 136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6 ncurses-$NCURSES_VERSION.tar.gz
    (cd "$work/ncurses-$NCURSES_VERSION" && ./configure --prefix="$prefix" --without-shared --with-normal --without-cxx --without-cxx-binding --without-ada --without-progs --without-tests --without-manpages --disable-db-install --with-terminfo-dirs=/etc/terminfo:/lib/terminfo:/usr/share/terminfo:/usr/lib/terminfo --with-default-terminfo-dir=/usr/share/terminfo && make -j"$(nproc)" && make install)
    export CFLAGS=-O2
    static=--enable-static
    ;;
  *) echo "unknown target: $target" >&2; exit 1 ;;
esac

(cd "$work/libevent-$LIBEVENT_VERSION" && ./configure $host --prefix="$prefix" --disable-shared --enable-static --disable-openssl --disable-samples --disable-libevent-regress --disable-debug-mode && make -j4 && make install)
(cd "$work/tmux-$TMUX_VERSION" && ./configure $host $static LIBEVENT_CORE_CFLAGS="-I$prefix/include" LIBEVENT_CORE_LIBS="$prefix/lib/libevent_core.a" LIBUTF8PROC_CFLAGS="-I$prefix/include" LIBUTF8PROC_LIBS="$prefix/lib/libutf8proc.a" CPPFLAGS="-I$prefix/include -I$prefix/include/ncurses" LDFLAGS="-L$prefix/lib" && make -j4)

cp "$work/tmux-$TMUX_VERSION/tmux" "$out"
strip "$out"
"$out" -V
