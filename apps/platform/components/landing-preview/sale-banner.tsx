"use client"

import Image from 'next/image'
import { SALE, SALE_COURSES, saleBadge } from './sale-data'

/**
 * Renders the Holiday Season Sale grid for Neil Gray's courses.
 */
export function SaleBanner() {
  return (
    <section className='bg-background py-20 px-6'>
      <div className='mx-auto max-w-6xl'>
        <div className='mb-6 text-center'>
          <h2 className='text-3xl sm:text-4xl font-bold text-foreground'>
            Courses on Sale
          </h2>
        </div>
        <div className='mb-10 text-center text-sm uppercase tracking-widest text-muted-foreground'>
          {SALE.name} · Limited time only
        </div>

        <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-3'>
          {SALE_COURSES.map((course) => (
            <a
              key={course.id}
              href={course.checkoutUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='group block overflow-hidden bg-card border border-border hover:border-primary/50 transition-colors'
            >
              <div className='relative aspect-square w-full overflow-hidden bg-muted'>
                <Image
                  src={course.cardImage}
                  alt={course.title}
                  fill
                  className='object-contain transition-transform group-hover:scale-105'
                  sizes='(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw'
                />
                <div className='absolute top-3 left-3'>
                  <span className='inline-block bg-red-600 px-3 py-1 text-xs sm:text-sm font-semibold text-white shadow'>
                    {saleBadge(course.percentOff)}
                  </span>
                </div>
              </div>

              <div className='p-4 space-y-3'>
                <h3 className='text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2'>
                  {course.title}
                </h3>
                <p className='text-sm'>
                  <span className='text-base font-semibold text-foreground'>
                    ${course.salePrice}
                  </span>
                  <span className='text-muted-foreground'>
                    {' '}— Regular Price <s>${course.regularPrice}</s>
                  </span>
                </p>
              </div>
            </a>
          ))}
        </div>

        <div className='mt-10 text-center'>
          <a
            href='https://home.huckleberry.art/store'
            target='_blank'
            rel='noopener noreferrer'
            className='inline-block text-primary hover:text-primary/80 font-semibold text-sm uppercase tracking-wider'
          >
            See All Courses →
          </a>
        </div>
      </div>
    </section>
  )
}
