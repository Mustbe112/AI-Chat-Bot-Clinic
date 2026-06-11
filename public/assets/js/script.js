document.addEventListener('DOMContentLoaded', () => {

  // ── Active nav link ──────────────────────────────────────
  const currentPage = location.pathname.split('/').pop() || 'index.html'
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(a => {
    const href = a.getAttribute('href')
    const isHome = href === '../index.html' || href === 'index.html' || href.endsWith('/index.html')
    const isCurrentHome = currentPage === '' || currentPage === 'index.html' || currentPage === '/'
    if ((isHome && isCurrentHome) || (href === currentPage) || (href.endsWith(currentPage))) {
      a.classList.add('active')
    }
  })

  // ── Sticky nav shadow ────────────────────────────────────
  const nav = document.querySelector('.nav')
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  // ── Hamburger ────────────────────────────────────────────
  const hamburger   = document.querySelector('.hamburger')
  const mobileMenu  = document.querySelector('.mobile-menu')

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open')
      mobileMenu.classList.toggle('open', open)
      document.body.style.overflow = open ? 'hidden' : ''
    })

    // Close when a link is tapped
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open')
        mobileMenu.classList.remove('open')
        document.body.style.overflow = ''
      })
    })

    // Close on outside tap
    document.addEventListener('click', e => {
      if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
        hamburger.classList.remove('open')
        mobileMenu.classList.remove('open')
        document.body.style.overflow = ''
      }
    })
  }

  // ── Scroll fade-in ───────────────────────────────────────
  const fadeEls = document.querySelectorAll('.fade-up')
  if (fadeEls.length) {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible')
          observer.unobserve(e.target)
        }
      }),
      { threshold: 0.12 }
    )
    fadeEls.forEach((el, i) => {
      el.style.transitionDelay = `${i * 0.07}s`
      observer.observe(el)
    })
  }

  // ── Smooth anchor scroll ─────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'))
      if (target) {
        e.preventDefault()
        const offset = document.querySelector('.nav')?.offsetHeight || 72
        window.scrollTo({ top: target.offsetTop - offset - 16, behavior: 'smooth' })
      }
    })
  })

})