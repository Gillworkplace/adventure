#pragma once
#include "core.hpp"
struct Compact {
 Codec codec;
 std::vector<std::array<int,23>> add;
 std::vector<std::array<int,5>> remove;
 std::vector<std::array<int16_t,16>> sub;
 static constexpr int R=48,Q=6,K=64,TG=12;
 const float *B=nullptr,*T=nullptr,*GT=nullptr;
 const int16_t *AQ=nullptr,*PQ=nullptr,*GQ=nullptr;
 float as=1,ps=1,gs=1;
 struct Row {int tag=-1;float v[339];};
 mutable std::vector<Row> cache=std::vector<Row>(2048);
 int horizon()const{return R;}
 Compact(const char*data,size_t bytes){
  if(bytes!=39512548)throw std::runtime_error("Invalid COMPACT48 size");
  int header[8];std::memcpy(header,data,32);
  const int expected[8]={0x56435332,48,N+1,6,64,12,0,0};
  if(!std::equal(header,header+8,expected))throw std::runtime_error("Invalid COMPACT48 header");
  size_t offset=32;
  auto take=[&](size_t count,size_t width){
   if(count>(bytes-offset)/width)throw std::runtime_error("Truncated COMPACT48 model");
   const char*p=data+offset;offset+=count*width;return p;
  };
  auto scale=[&](){float v;std::memcpy(&v,take(1,4),4);if(!std::isfinite(v)||v<=0)throw std::runtime_error("Invalid quantization scale");return v;};
  B=reinterpret_cast<const float*>(take((R+1)*2*(N+1),4));
  T=reinterpret_cast<const float*>(take((R+1)*Q,4));
  as=scale();AQ=reinterpret_cast<const int16_t*>(take(size_t(2)*(N+1)*275*Q,2));
  ps=scale();PQ=reinterpret_cast<const int16_t*>(take(80730*K,2));
  GT=reinterpret_cast<const float*>(take((R+1)*TG,4));
  gs=scale();GQ=reinterpret_cast<const int16_t*>(take(size_t(2)*(N+1)*K*TG,2));
  if(offset!=bytes)throw std::runtime_error("Unexpected COMPACT48 data");
  add.resize(14950);sub.resize(80730);remove.resize(80730);int c[5]={},ix=0;
  auto gen=[&](auto&&self,int pos,int n,int low)->void{if(pos==n){sub[ix].fill(-1);for(int j=0;j<n;j++){int d[5],k=0;for(int t=0;t<n;t++)if(t!=j)d[k++]=c[t];remove[ix][j]=codec.rank(d,n-1);}int z=0;for(int j=0;j<n;j++)sub[ix][z++]=c[j]-1;for(int j=0;j<n;j++)for(int k=j+1;k<n;k++){int p[2]={c[j],c[k]};sub[ix][z++]=codec.rank(p,2)-1;}if(n<5)for(int x=1;x<=22;x++){int d[5];std::copy(c,c+n,d);d[n]=x;std::sort(d,d+n+1);add[ix][x]=codec.rank(d,n+1);}ix++;return;}for(int x=low;x<=22;x++){c[pos]=x;self(self,pos+1,n,x);}};for(int n=0;n<=5;n++)gen(gen,0,n,1);
 }
 double val(int r,int b,int p,int h,int n)const{
  if(!r&&!b)return p;int x=b*(N+1)+p,row=r*2*(N+1)+x;if(!n)return B[row];

  Row&z=cache[(uint32_t(row)*2654435761u)&2047];
  if(z.tag!=row){z.tag=row;const float*t=&T[r*Q];
   {for(int c=0;c<275;c++){double v=0;const int16_t*a=&AQ[(size_t(x)*275+c)*Q];for(int j=0;j<Q;j++)v+=t[j]*(a[j]*as);z.v[c]=v;}}
   for(int k=0;k<K;k++){double v=0;for(int j=0;j<TG;j++)v+=GT[r*TG+j]*(GQ[(size_t(x)*K+k)*TG+j]*gs);z.v[275+k]=v;}
  }
  double v=B[row];for(int j=0;j<15&&sub[h][j]>=0;j++)v+=z.v[sub[h][j]];
  for(int k=0;k<K;k++)v+=(PQ[h*K+k]*ps)*z.v[275+k];
  return v;
 }
};
